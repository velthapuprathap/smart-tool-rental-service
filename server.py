from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response
import pandas as pd
import os
from datetime import datetime, timedelta
import json
import secrets
import threading
import time
import random
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient


app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)


# ==================== USER DATABASE ====================


users_db = {}
USERS_FILE = 'static/data/users.json'


def load_users():
    global users_db
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'r') as f:
                users_db = json.load(f)
            print(f"✓ Loaded {len(users_db)} existing users")
        except Exception as e:
            print(f"Error loading users: {e}")
            users_db = {}
    else:
        users_db = {}


def save_users():
    try:
        os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
        with open(USERS_FILE, 'w') as f:
            json.dump(users_db, f, indent=2)
    except Exception as e:
        print(f"Error saving users: {e}")


load_users()


# ==================== DATA STORAGE ====================


DATA_DIR = 'static/data/'
realtime_data = {
    'nearby_tools': [],
    'bookings': [],
    'operator_events': [],
    'feedback': [],
    'issues': [],
    'revenue': [],
    'tool_status': [],
    'late_returns': [],
    'geofence': []
}


new_bookings = []
new_tools = []


sse_queues = {
    'owner': [],
    'renter': [],
    'operator': []
}


# ==================== AWS IOT CONFIGURATION ====================


IOT_ENDPOINT = os.getenv("IOT_ENDPOINT", "a1skqzr4mnhkyk-ats.iot.us-east-1.amazonaws.com")
CLIENT_ID = "WebDashboard_" + secrets.token_hex(4)
CERT_DIR = "Certificates/"


TOPICS = {
    'nearby_tools': 'toolease/renter/nearby_tools',
    'bookings': 'toolease/renter/bookings',
    'operator_events': 'toolease/renter/operator_events',
    'revenue': 'toolease/owner/revenue',
    'tool_status': 'toolease/owner/tool_status',
    'late_returns': 'toolease/owner/late_returns',
    'geofence': 'toolease/owner/geofence_breach'
}


OWNER_TOOL_MAP = {
    "T001": "Prathap", "T002": "Agnick", "T003": "Dev", "T004": "Lasya",
    "T005": "Ruthvika", "T006": "Ajay", "T007": "Shyam", "T008": "Srikanth",
    "T009": "Meera", "T010": "Karthik"
}


TOOL_CATALOG = {
    "Drill": {"hourly_rate": 150, "daily_rate": 1000},
    "CNC Laser Cutter": {"hourly_rate": 200, "daily_rate": 1400},
    "Plasma Cutter": {"hourly_rate": 120, "daily_rate": 800},
    "Mini Excavator": {"hourly_rate": 300, "daily_rate": 2000},
    "Lathe": {"hourly_rate": 250, "daily_rate": 1800},
    "Floor Sanders": {"hourly_rate": 80, "daily_rate": 500}
}

# Tool images mapping (add after TOOL_CATALOG)
TOOL_IMAGES = {
    "Drill": "/static/images/tools/drill.png",
    "CNC Laser Cutter": "/static/images/tools/cnc-laser.png",
    "Plasma Cutter": "/static/images/tools/plasma-cutter.png",
    "Mini Excavator": "/static/images/tools/excavator.png",
    "Lathe": "/static/images/tools/lathe.png",
    "Floor Sanders": "/static/images/tools/floor-sander.png"
}

# ==================== MQTT CALLBACKS ====================


def on_message_callback(client, userdata, message):
    try:
        topic = message.topic
        payload = json.loads(message.payload.decode('utf-8'))
        
        for key, topic_name in TOPICS.items():
            if topic == topic_name:
                realtime_data[key].append(payload)
                if len(realtime_data[key]) > 1000:
                    realtime_data[key] = realtime_data[key][-1000:]
                notify_clients(key, payload)
                break
    except Exception as e:
        print(f"Error processing message: {e}")


def notify_clients(data_type, payload):
    event = {
        'type': data_type,
        'data': payload,
        'timestamp': datetime.now().isoformat()
    }
    for role in sse_queues:
        sse_queues[role].append(event)


# ==================== MQTT SETUP ====================


def setup_mqtt_client():
    try:
        mqtt_client = AWSIoTMQTTClient(CLIENT_ID)
        mqtt_client.configureEndpoint(IOT_ENDPOINT, 8883)
        mqtt_client.configureCredentials(
            os.path.join(CERT_DIR, "AmazonRootCA1.pem"),
            os.path.join(CERT_DIR, "private.pem.key"),
            os.path.join(CERT_DIR, "device-cert.crt")
        )
        
        mqtt_client.configureAutoReconnectBackoffTime(1, 32, 20)
        mqtt_client.configureOfflinePublishQueueing(-1)
        mqtt_client.configureDrainingFrequency(2)
        mqtt_client.configureConnectDisconnectTimeout(10)
        mqtt_client.configureMQTTOperationTimeout(5)
        
        print("Connecting to AWS IoT Core...")
        mqtt_client.connect()
        print("✓ Connected to AWS IoT Core!")
        
        for topic_name in TOPICS.values():
            mqtt_client.subscribe(topic_name, 1, on_message_callback)
            print(f"✓ Subscribed to {topic_name}")
        
        return mqtt_client
    except Exception as e:
        print(f"MQTT Setup Error: {e}")
        return None


mqtt_client = None
def start_mqtt_thread():
    global mqtt_client
    mqtt_client = setup_mqtt_client()


mqtt_thread = threading.Thread(target=start_mqtt_thread, daemon=True)
mqtt_thread.start()


# ==================== LOAD CSV DATA ====================


def load_csv_data():
    """Load CSV files and clean NaN values"""
    global realtime_data
    try:
        files = {
            'nearby_tools': 'renter_nearby_tools.csv',
            'bookings': 'renter_bookings.csv',
            'operator_events': 'renter_operator_events.csv',
            'feedback': 'renter_feedback.csv',
            'issues': 'renter_issues.csv',
            'revenue': 'owner_revenue.csv',
            'tool_status': 'owner_tool_status.csv',
            'late_returns': 'owner_late_returns.csv',
            'geofence': 'owner_geofence_breach.csv'
        }
        
        for key, filename in files.items():
            filepath = os.path.join(DATA_DIR, filename)
            if os.path.exists(filepath):
                df = pd.read_csv(filepath)
                df = df.where(pd.notnull(df), None)
                realtime_data[key] = df.to_dict('records')
                print(f"✓ Loaded {len(realtime_data[key])} records from {filename}")
            else:
                print(f"⚠ File not found: {filename}")
                realtime_data[key] = []
        
        print(f"\n✓ Total tools loaded: {len(realtime_data['nearby_tools'])}")
        print(f"✓ Total bookings loaded: {len(realtime_data['bookings'])}")
        
    except Exception as e:
        print(f"❌ Error loading CSV data: {e}")


load_csv_data()


# ==================== GENERATE TEST DATA ====================


def generate_completed_assignments():
    """Generate some completed assignments for testing"""
    global realtime_data
    
    operators = ['Rajesh Kumar', 'Suresh Patil', 'Amit Singh', 'Vikram Reddy', 'Sanjay Rao']
    
    for i in range(8):
        operator_name = operators[i % len(operators)]
        booking_id = f"BK{1000 + i}"
        
        # Create times - proper datetime objects
        arrival_time = datetime.now() - timedelta(hours=i*2)
        expected_arrival = arrival_time - timedelta(minutes=random.randint(5, 30))
        
        # Mix of ON_TIME and LATE assignments
        is_late = i % 2 == 0
        late_mins = random.randint(10, 45) if is_late else 0
        
        completed_event = {
            'booking_id': booking_id,
            'toolid': f"T{(i % 10) + 1:03d}",
            'renter_id': f"R{1000 + i}",
            'operator_requested': True,
            'operator_name': operator_name,
            'operator_assigned_iso': (datetime.now() - timedelta(hours=i*2 + 2)).isoformat(),
            'expected_arrival_iso': expected_arrival.isoformat(),
            'arrival_iso': arrival_time.isoformat(),
            'arrival_status': 'LATE' if is_late else 'ON_TIME',
            'late_mins_operator': late_mins,
            'compensation_to_renter_inr': 350 if is_late else 0,
            'latitude': 17.385044 + random.uniform(-0.01, 0.01),
            'longitude': 78.486671 + random.uniform(-0.01, 0.01)
        }
        
        realtime_data['operator_events'].append(completed_event)
    
    print(f"✓ Generated 8 completed assignments for testing")
    print(f"✓ Total operator events: {len(realtime_data['operator_events'])}")
    
    # Print sample for debugging
    if realtime_data['operator_events']:
        sample = realtime_data['operator_events'][0]
        print(f"Sample event: Booking {sample['booking_id']}, Status: {sample.get('arrival_status')}")


generate_completed_assignments()


# ==================== AUTHENTICATION DECORATOR ====================


def login_required(role=None):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return redirect(url_for('index'))
            if role and session['user']['role'] != role:
                return redirect(url_for('index'))
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ==================== ROUTES ====================


@app.route('/')
def index():
    if 'user' in session:
        role = session['user']['role']
        return redirect(url_for(f'{role}_dashboard'))
    return render_template('index.html')


@app.route('/check-session')
def check_session():
    if 'user' in session:
        return jsonify({'authenticated': True, 'user': session['user']})
    return jsonify({'authenticated': False})


@app.route('/stream/<role>')
def stream(role):
    def event_stream():
        while True:
            if sse_queues.get(role):
                event = sse_queues[role].pop(0)
                yield f"data: {json.dumps(event)}\n\n"
            time.sleep(1)
    return Response(event_stream(), mimetype='text/event-stream')


# ==================== AUTHENTICATION ====================


@app.route('/signup', methods=['POST'])
def signup():
    try:
        data = request.json
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        phone = data.get('phone', '').strip()
        role = data.get('role', '').strip()
        
        if not email or not password or not name or not phone or not role:
            return jsonify({'success': False, 'error': 'All fields are required'}), 400
        
        if len(password) < 6:
            return jsonify({'success': False, 'error': 'Password must be at least 6 characters'}), 400
        
        if email in users_db:
            return jsonify({'success': False, 'error': 'Email already registered. Please login.'}), 400
        
        user_id = f"{role[0].upper()}{str(int(datetime.now().timestamp()))[-6:]}"
        password_hash = generate_password_hash(password)
        
        user_data = {
            'id': user_id,
            'name': name,
            'email': email,
            'phone': phone,
            'role': role,
            'password_hash': password_hash,
            'business_type': data.get('business_type', ''),
            'address': data.get('address', ''),
            'rating': 4.5,
            'created_at': datetime.now().isoformat(),
            'verified': True
        }
        
        users_db[email] = user_data
        save_users()
        
        session.permanent = True
        session['user'] = {
            'id': user_id,
            'name': name,
            'email': email,
            'phone': phone,
            'role': role,
            'rating': 4.5
        }
        
        return jsonify({'success': True, 'role': role, 'message': 'Account created successfully!'})
        
    except Exception as e:
        print(f"Signup error: {e}")
        return jsonify({'success': False, 'error': 'An error occurred during signup'}), 500


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.json
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()
        
        if not email or not password:
            return jsonify({'success': False, 'error': 'Email and password are required'}), 400
        
        if email not in users_db:
            return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
        
        user_data = users_db[email]
        
        if not check_password_hash(user_data['password_hash'], password):
            return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
        
        session.permanent = True
        session['user'] = {
            'id': user_data['id'],
            'name': user_data['name'],
            'email': user_data['email'],
            'phone': user_data['phone'],
            'role': user_data['role'],
            'rating': user_data.get('rating', 4.5)
        }
        
        return jsonify({'success': True, 'role': user_data['role'], 'message': 'Login successful!'})
        
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({'success': False, 'error': 'An error occurred during login'}), 500


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


# ==================== OWNER ROUTES ====================


@app.route('/owner/dashboard')
@login_required(role='owner')
def owner_dashboard():
    user = session['user']
    owner_name = user['name']
    
    owner_new_tools = [t for t in new_tools if t.get('added_by') == owner_name]
    
    stats = {
        'total_tools': len(owner_new_tools),
        'total_revenue': 0,
        'active_rentals': 0,
        'alerts': 0
    }
    
    return render_template('owner_dashboard.html', user=user, stats=stats, owner_tools=[], tool_catalog=TOOL_CATALOG)


@app.route('/api/owner/add-tool', methods=['POST'])
def add_tool():
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    data = request.json
    owner_name = session['user']['name']
    
    all_tool_numbers = [int(tid[1:]) for tid in OWNER_TOOL_MAP.keys() if tid.startswith('T')]
    all_tool_numbers.extend([int(t['toolid'][1:]) for t in new_tools if t['toolid'].startswith('T')])
    next_num = max(all_tool_numbers) + 1 if all_tool_numbers else 11
    
    tool_id = f"T{str(next_num).zfill(3)}"
    
    base_temp = 25 + random.uniform(-5, 15)
    base_voltage = 230 + random.uniform(-10, 5)
    
    new_tool = {
        'toolid': tool_id,
        'tool_type': data['tool_type'],
        'tool_name': data.get('tool_name', ''),
        'hourly_rate': float(data['hourly_rate']),
        'daily_rate': float(data['daily_rate']),
        'latitude': float(data['geo_lat']),
        'longitude': float(data['geo_lng']),
        'geo_center_lat': float(data['geo_lat']),
        'geo_center_lng': float(data['geo_lng']),
        'geo_radius_m': float(data.get('geo_radius', 5000)),
        'temperature_c': round(base_temp, 2),
        'voltage_v': round(base_voltage, 1),
        'vibration_hz': round(random.uniform(20, 60), 1),
        'sensor_active': True,
        'ts_iso': datetime.now().isoformat(),
        'availability': 'AVAILABLE',
        'added_by': owner_name,
        'added_at': datetime.now().isoformat()
    }
    
    new_tools.append(new_tool)
    realtime_data['nearby_tools'].append(new_tool)
    OWNER_TOOL_MAP[tool_id] = owner_name
    
    print(f"✓ Added new tool {tool_id} for owner {owner_name}")
    
    return jsonify({
        'success': True,
        'tool_id': tool_id,
        'message': f'Tool {tool_id} added successfully',
        'tool': new_tool
    })


@app.route('/api/owner/tools')
def get_owner_tools():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    owner_name = session['user']['name']
    
    tools_data = []
    for new_tool in new_tools:
        if new_tool.get('added_by') == owner_name:
            new_tool['temperature_c'] = round(new_tool.get('temperature_c', 25) + random.uniform(-3, 3), 2)
            new_tool['voltage_v'] = round(new_tool.get('voltage_v', 230) + random.uniform(-2, 2), 1)
            new_tool['vibration_hz'] = round(random.uniform(20, 60), 1)
            new_tool['ts_iso'] = datetime.now().isoformat()
            tools_data.append(new_tool)
    
    print(f"✓ Returning {len(tools_data)} tools for owner {owner_name}")
    
    return jsonify({'success': True, 'tools': tools_data})


@app.route('/api/owner/tool-status/<tool_id>')
def get_tool_status(tool_id):
    for tool in new_tools:
        if tool.get('toolid') == tool_id:
            return jsonify({'success': True, 'data': tool})
    
    return jsonify({'success': False, 'error': 'Tool not found'}), 404


@app.route('/api/owner/late-returns')
def get_late_returns():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    owner_name = session['user']['name']
    owner_added_tools = [t['toolid'] for t in new_tools if t.get('added_by') == owner_name]
    
    if not owner_added_tools:
        return jsonify({'success': True, 'data': []})
    
    cleaned_data = []
    for tool_id in owner_added_tools[:2]:
        for i in range(2):
            cleaned_data.append({
                'booking_id': f"BK{int(datetime.now().timestamp()) + i}",
                'toolid': tool_id,
                'renter_id': f"R{random.randint(1000, 9999)}",
                'expected_return_iso': (datetime.now() - timedelta(days=random.randint(1, 5))).isoformat(),
                'actual_return_iso': datetime.now().isoformat(),
                'delay_hours': random.randint(2, 48),
                'penalty_inr': random.randint(100, 1000),
                'penalty_paid': random.choice([True, False])
            })
    
    return jsonify({'success': True, 'data': cleaned_data})


@app.route('/api/owner/geofence')
def get_geofence():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    owner_name = session['user']['name']
    owner_added_tools = [t for t in new_tools if t.get('added_by') == owner_name]
    
    if not owner_added_tools:
        return jsonify({'success': True, 'data': []})
    
    cleaned_data = []
    for tool in owner_added_tools:
        within_fence = random.choice([True, True, False])
        
        if within_fence:
            lat_offset = random.uniform(-0.002, 0.002)
            lng_offset = random.uniform(-0.002, 0.002)
            distance = random.uniform(0.1, 2)
        else:
            lat_offset = random.uniform(-0.01, 0.01)
            lng_offset = random.uniform(-0.01, 0.01)
            distance = random.uniform(5.5, 8)
        
        cleaned_data.append({
            'toolid': tool['toolid'],
            'latitude': tool['latitude'] + lat_offset,
            'longitude': tool['longitude'] + lng_offset,
            'geo_center_lat': tool.get('geo_center_lat', tool['latitude']),
            'geo_center_lng': tool.get('geo_center_lng', tool['longitude']),
            'geo_radius_m': tool.get('geo_radius_m', 5000),
            'within_fence': within_fence,
            'distance_from_center_km': round(distance, 2),
            'breach_type': 'entry' if within_fence else 'exit',
            'ts_iso': datetime.now().isoformat()
        })
    
    return jsonify({'success': True, 'data': cleaned_data})


@app.route('/api/owner/revenue')
def get_revenue():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    owner_name = session['user']['name']
    owner_added_tools = [t['toolid'] for t in new_tools if t.get('added_by') == owner_name]
    
    if not owner_added_tools:
        return jsonify({'success': True, 'data': []})
    
    cleaned_revenue = []
    for tool_id in owner_added_tools:
        for day in range(7):
            date = datetime.now() - timedelta(days=day)
            cleaned_revenue.append({
                'toolid': tool_id,
                'date_iso': date.isoformat(),
                'rentals_count': random.randint(0, 5),
                'total_rental_hours': round(random.uniform(0, 12), 1),
                'revenue_inr': round(random.uniform(500, 5000), 2)
            })
    
    return jsonify({'success': True, 'data': cleaned_revenue})


# ==================== RENTER ROUTES ====================


@app.route('/renter/dashboard')
@login_required(role='renter')
def renter_dashboard():
    user = session['user']
    renter_id = user['id']
    
    bookings_data = realtime_data.get('bookings', []) + new_bookings
    renter_bookings = [b for b in bookings_data if b.get('renter_id') == renter_id]
    
    stats = {
        'active_bookings': len([b for b in renter_bookings if b.get('payment_status') == 'SUCCESS']),
        'total_spent': sum(b.get('amount_inr', 0) for b in renter_bookings),
        'completed_bookings': len([b for b in renter_bookings if b.get('cancel_status') == 'NONE'])
    }
    
    return render_template('renter_dashboard.html', user=user, stats=stats)


@app.route('/api/renter/nearby-tools')
def get_nearby_tools():
    nearby_data = realtime_data.get('nearby_tools', [])
    
    print(f"📍 API called: nearby-tools, found {len(nearby_data)} tools")
    
    cleaned_tools = []
    for tool in nearby_data:
        cleaned_tool = {}
        for key, value in tool.items():
            if value is None or (isinstance(value, float) and pd.isna(value)):
                cleaned_tool[key] = None
            else:
                cleaned_tool[key] = value
        
        tool_type = cleaned_tool.get('tool_type', 'Drill')
        if tool_type in TOOL_CATALOG:
            cleaned_tool['hourly_rate'] = TOOL_CATALOG[tool_type]['hourly_rate']
            cleaned_tool['daily_rate'] = TOOL_CATALOG[tool_type]['daily_rate']
        else:
            cleaned_tool['hourly_rate'] = 150
            cleaned_tool['daily_rate'] = 1000
        
        # ✅ ADD TOOL IMAGE
        cleaned_tool['tool_image'] = TOOL_IMAGES.get(tool_type, "/static/images/tools/drill.png")
        
        cleaned_tools.append(cleaned_tool)
    
    return jsonify({'success': True, 'tools': cleaned_tools})


@app.route('/api/renter/book-tool', methods=['POST'])
def book_tool():
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    data = request.json
    renter_id = session['user']['id']
    
    booking_id = f"BK{int(datetime.now().timestamp())}"
    
    booking = {
        'booking_id': booking_id,
        'toolid': data['tool_id'],
        'renter_id': renter_id,
        'booked_iso': datetime.now().isoformat(),
        'rental_start_iso': data['start_date'],
        'rental_end_iso': data['end_date'],
        'operator_requested': data.get('operator_needed', False),
        'payment_status': 'SUCCESS',
        'cancel_status': 'NONE',
        'amount_inr': data['amount'],
        'currency': 'INR'
    }
    
    # ✅ FIX: Only add to realtime_data (removed new_bookings.append)
    realtime_data['bookings'].append(booking)
    notify_clients('bookings', booking)
    
    if data.get('operator_needed', False):
        operators = ['Rajesh Kumar', 'Suresh Patil', 'Amit Singh', 'Vikram Reddy', 'Sanjay Rao']
        operator_name = random.choice(operators)
        
        rental_start = datetime.fromisoformat(data['start_date'])
        expected_arrival = rental_start + timedelta(minutes=30)
        
        operator_event = {
            'booking_id': booking_id,
            'toolid': data['tool_id'],
            'renter_id': renter_id,
            'operator_requested': True,
            'operator_name': operator_name,
            'operator_assigned_iso': datetime.now().isoformat(),
            'expected_arrival_iso': expected_arrival.isoformat(),
            'arrival_iso': None,
            'arrival_status': None,
            'late_mins_operator': 0,
            'compensation_to_renter_inr': 0,
            'latitude': float(data.get('geo_lat', 17.385044)),
            'longitude': float(data.get('geo_lng', 78.486671))
        }
        
        realtime_data['operator_events'].append(operator_event)
        notify_clients('operator_events', operator_event)
        
        print(f"✓ Created operator tracking for booking {booking_id} - Operator: {operator_name}")
    
    return jsonify({'success': True, 'booking': booking})

@app.route('/api/renter/bookings')
def get_renter_bookings():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    renter_id = session['user']['id']
    
    # ✅ FIX: Only use realtime_data (removed + new_bookings)
    bookings_data = realtime_data.get('bookings', [])
    renter_bookings = [b for b in bookings_data if b.get('renter_id') == renter_id]
    
    # ADD TOOL NAMES TO BOOKINGS
    for booking in renter_bookings:
        tool_id = booking.get('toolid')
        
        # Find tool in nearby_tools to get tool_type
        tool_info = None
        for tool in realtime_data.get('nearby_tools', []):
            if tool.get('toolid') == tool_id:
                tool_info = tool
                break
        
        # Check in new_tools if not found
        if not tool_info:
            for tool in new_tools:
                if tool.get('toolid') == tool_id:
                    tool_info = tool
                    break
        
        # Add tool information to booking
        if tool_info:
            booking['tool_type'] = tool_info.get('tool_type', 'Unknown Tool')
            booking['tool_name'] = tool_info.get('tool_name', tool_info.get('tool_type', 'Tool'))
        else:
            booking['tool_type'] = 'Unknown Tool'
            booking['tool_name'] = 'Tool'
    
    return jsonify({'success': True, 'bookings': renter_bookings})
@app.route('/api/renter/operator-tracking')
def get_operator_tracking():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    renter_id = session['user']['id']
    
    bookings_data = realtime_data.get('bookings', []) + new_bookings
    renter_bookings = [b for b in bookings_data if b.get('renter_id') == renter_id]
    booking_ids = [b['booking_id'] for b in renter_bookings]
    
    operator_data = realtime_data.get('operator_events', [])
    operator_filtered = [o for o in operator_data if o.get('booking_id') in booking_ids]
    
    print(f"📍 Operator tracking: Found {len(operator_filtered)} events for renter {renter_id}")
    
    if not operator_filtered:
        for booking in renter_bookings:
            if booking.get('operator_requested'):
                operators = ['Rajesh Kumar', 'Suresh Patil', 'Amit Singh', 'Vikram Reddy']
                operator_name = random.choice(operators)
                
                rental_start = datetime.fromisoformat(booking['rental_start_iso'])
                expected_arrival = rental_start + timedelta(minutes=30)
                
                operator_event = {
                    'booking_id': booking['booking_id'],
                    'toolid': booking['toolid'],
                    'renter_id': renter_id,
                    'operator_requested': True,
                    'operator_name': operator_name,
                    'operator_assigned_iso': booking['booked_iso'],
                    'expected_arrival_iso': expected_arrival.isoformat(),
                    'arrival_iso': None,
                    'arrival_status': None,
                    'late_mins_operator': 0,
                    'compensation_to_renter_inr': 0,
                    'latitude': 17.385044,
                    'longitude': 78.486671
                }
                
                realtime_data['operator_events'].append(operator_event)
                operator_filtered.append(operator_event)
    
    return jsonify({'success': True, 'data': operator_filtered})


# ==================== FEEDBACK ROUTES ====================

@app.route('/api/renter/feedback', methods=['GET', 'POST'])
def renter_feedback():
    if 'user' not in session or session.get('user', {}).get('role') != 'renter':
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    renter_id = session['user']['id']
    
    if request.method == 'GET':
        # Get submitted feedback for this renter
        feedback_data = realtime_data.get('feedback', [])
        renter_feedback_list = [f for f in feedback_data if f.get('renterid') == renter_id]
        
        # Get bookings for this renter
        bookings_data = realtime_data.get('bookings', [])
        renter_bookings = [b for b in bookings_data if b.get('renter_id') == renter_id]
        
        # Get rental IDs that already have feedback
        submitted_rental_ids = set(f.get('rentalid') for f in renter_feedback_list)
        
        # Find bookings that need feedback (completed but no feedback)
        pending = []
        for booking in renter_bookings:
            booking_id = booking.get('booking_id')
            
            # Skip if already has feedback
            if booking_id in submitted_rental_ids:
                continue
            
            # Check if rental period has ended
            rental_end_iso = booking.get('rental_end_iso')
            if rental_end_iso:
                try:
                    end_time = datetime.fromisoformat(rental_end_iso.replace('Z', '+00:00'))
                    if end_time < datetime.now():
                        # Add tool information
                        tool_id = booking.get('toolid')
                        tool_info = None
                        
                        # Find tool in nearby_tools
                        for tool in realtime_data.get('nearby_tools', []):
                            if tool.get('toolid') == tool_id:
                                tool_info = tool
                                break
                        
                        # Check in new_tools if not found
                        if not tool_info:
                            for tool in new_tools:
                                if tool.get('toolid') == tool_id:
                                    tool_info = tool
                                    break
                        
                        # Add tool name to booking
                        if tool_info:
                            booking['tool_name'] = tool_info.get('tool_name', tool_info.get('tool_type', 'Tool'))
                            booking['tool_type'] = tool_info.get('tool_type', 'Tool')
                        else:
                            booking['tool_name'] = 'Tool'
                            booking['tool_type'] = 'Tool'
                        
                        pending.append(booking)
                except Exception as e:
                    print(f"Error parsing date: {e}")
                    continue
        
        # Add tool names to submitted feedback
        for feedback in renter_feedback_list:
            tool_id = feedback.get('toolid')
            tool_info = None
            
            # Find tool in nearby_tools
            for tool in realtime_data.get('nearby_tools', []):
                if tool.get('toolid') == tool_id:
                    tool_info = tool
                    break
            
            # Check in new_tools if not found
            if not tool_info:
                for tool in new_tools:
                    if tool.get('toolid') == tool_id:
                        tool_info = tool
                        break
            
            # Add tool information
            if tool_info:
                feedback['tool_name'] = tool_info.get('tool_name', tool_info.get('tool_type', 'Tool'))
                feedback['tool_type'] = tool_info.get('tool_type', 'Tool')
            else:
                feedback['tool_name'] = 'Tool'
                feedback['tool_type'] = 'Tool'
        
        print(f"✓ Feedback GET: {len(renter_feedback_list)} submitted, {len(pending)} pending for renter {renter_id}")
        
        return jsonify({
            'success': True,
            'feedback': renter_feedback_list,
            'pending': pending
        })
    
    elif request.method == 'POST':
        # Submit new feedback
        data = request.json
        
        booking_id = data.get('booking_id')
        tool_id = data.get('tool_id')
        rating = float(data.get('rating', 0))
        feedback_text = data.get('feedback', '').strip()
        damage_flag = data.get('damage_flag', False)
        
        # Validate data
        if not booking_id or not tool_id:
            return jsonify({'success': False, 'error': 'Missing booking or tool ID'}), 400
        
        if rating < 1 or rating > 5:
            return jsonify({'success': False, 'error': 'Rating must be between 1 and 5'}), 400
        
        # Check if feedback already exists for this booking
        feedback_data = realtime_data.get('feedback', [])
        existing = [f for f in feedback_data if f.get('rentalid') == booking_id]
        
        if existing:
            return jsonify({'success': False, 'error': 'Feedback already submitted for this booking'}), 400
        
        # Create feedback entry
        feedback_entry = {
            'rentalid': booking_id,
            'toolid': tool_id,
            'renterid': renter_id,
            'rating': rating,
            'feedback': feedback_text,
            'returnediso': datetime.now().isoformat(),
            'damageflag': damage_flag,
            'tsiso': datetime.now().isoformat()
        }
        
        # Add to realtime data
        realtime_data['feedback'].append(feedback_entry)
        
        # Notify clients
        notify_clients('feedback', feedback_entry)
        
        print(f"✓ Feedback submitted: Booking {booking_id}, Rating {rating}, Damage: {damage_flag}")
        
        return jsonify({
            'success': True,
            'message': 'Feedback submitted successfully',
            'feedback': feedback_entry
        })

# ==================== OPERATOR ROUTES ====================


@app.route('/operator/dashboard')
@login_required(role='operator')
def operator_dashboard():
    user = session['user']
    operator_name = user['name']
    
    operator_data = realtime_data.get('operator_events', [])
    operator_assignments = [o for o in operator_data if o.get('operator_name') == operator_name]
    
    stats = {
        'total_assignments': len(operator_assignments),
        'completed': len([o for o in operator_assignments if o.get('arrival_status') == 'ON_TIME']),
        'pending': len([o for o in operator_assignments if not o.get('arrival_iso')]),
        'earnings': sum(o.get('compensation_to_renter_inr', 0) for o in operator_assignments if o.get('arrival_status') == 'ON_TIME') 
    }
    
    return render_template('operator_dashboard.html', user=user, stats=stats)


@app.route('/api/operator/requests')
def get_operator_requests():
    operator_data = realtime_data.get('operator_events', [])
    pending = [o for o in operator_data if not o.get('arrival_iso') and not o.get('accepted_iso')]
    
    locations = [
        "Hitech City, Hyderabad",
        "Gachibowli, Hyderabad",
        "Madhapur, Hyderabad",
        "Kondapur, Hyderabad",
        "Banjara Hills, Hyderabad",
        "Jubilee Hills, Hyderabad"
    ]
    
    for request in pending:
        tool_id = request.get('toolid')
        
        # Find tool info
        tool_info = None
        for tool in realtime_data.get('nearby_tools', []):
            if tool.get('toolid') == tool_id:
                tool_info = tool
                break
        
        if not tool_info:
            for tool in new_tools:
                if tool.get('toolid') == tool_id:
                    tool_info = tool
                    break
        
        # Add tool information
        if tool_info:
            request['tool_type'] = tool_info.get('tool_type', 'Tool')
            request['tool_name'] = tool_info.get('tool_name', tool_info.get('tool_type', 'Tool'))
        else:
            request['tool_type'] = 'Tool'
            request['tool_name'] = 'Tool'
        
        # ✅ ADD TOOL IMAGE
        tool_type = request.get('tool_type', 'Tool')
        request['tool_image'] = TOOL_IMAGES.get(tool_type, "/static/images/tools/drill.png")
        
        # Ensure expected_arrival_iso exists
        if not request.get('expected_arrival_iso'):
            hours_offset = random.randint(1, 24)
            minutes_offset = random.randint(0, 59)
            request['expected_arrival_iso'] = (datetime.now() + timedelta(hours=hours_offset, minutes=minutes_offset)).isoformat()
        
        # Vary estimated earnings based on tool type
        earnings_map = {
            'Drill': 300,
            'CNC Laser Cutter': 400,
            'Plasma Cutter': 350,
            'Mini Excavator': 500,
            'Lathe': 450,
            'Floor Sanders': 250
        }
        request['estimated_earnings'] = earnings_map.get(tool_type, 350)
        
        # Add location
        booking_id = request.get('booking_id', '')
        location_index = hash(booking_id) % len(locations)
        request['location_name'] = locations[location_index]
    
    print(f"✓ Returning {len(pending)} pending requests with tool images")
    
    return jsonify({'success': True, 'requests': pending})


@app.route('/api/operator/assignments')
def get_operator_assignments():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    operator_name = session['user']['name']
    operator_data = realtime_data.get('operator_events', [])
    assignments = [o for o in operator_data if o.get('operator_name') == operator_name]
    
    locations = [
        "Hitech City, Hyderabad",
        "Gachibowli, Hyderabad",
        "Madhapur, Hyderabad",
        "Kondapur, Hyderabad",
        "Banjara Hills, Hyderabad",
        "Jubilee Hills, Hyderabad"
    ]
    
    for assignment in assignments:
        tool_id = assignment.get('toolid')
        
        # Find tool info
        tool_info = None
        for tool in realtime_data.get('nearby_tools', []):
            if tool.get('toolid') == tool_id:
                tool_info = tool
                break
        
        if not tool_info:
            for tool in new_tools:
                if tool.get('toolid') == tool_id:
                    tool_info = tool
                    break
        
        # Add tool information
        if tool_info:
            assignment['tool_type'] = tool_info.get('tool_type', 'Tool')
            assignment['tool_name'] = tool_info.get('tool_name', tool_info.get('tool_type', 'Tool'))
        else:
            assignment['tool_type'] = 'Tool'
            assignment['tool_name'] = 'Tool'
        
        # ✅ ADD TOOL IMAGE
        tool_type = assignment.get('tool_type', 'Tool')
        assignment['tool_image'] = TOOL_IMAGES.get(tool_type, "/static/images/tools/drill.png")
        
        # Add location name
        booking_id = assignment.get('booking_id', '')
        location_index = hash(booking_id) % len(locations)
        assignment['location_name'] = locations[location_index]
    
    print(f"✓ Returning {len(assignments)} assignments with tool images for operator {operator_name}")
    
    return jsonify({'success': True, 'assignments': assignments})


@app.route('/api/operator/accept-request', methods=['POST'])
def accept_request():
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    data = request.json
    booking_id = data.get('booking_id')
    operator_name = session['user']['name']
    
    print(f"✓ Attempting to accept booking {booking_id} for operator {operator_name}")
    
    operator_data = realtime_data.get('operator_events', [])
    
    found = False
    for event in operator_data:
        if event.get('booking_id') == booking_id:
            # Mark as accepted but NOT arrived (shows as UPCOMING)
            event['operator_name'] = operator_name
            event['accepted_iso'] = datetime.now().isoformat()
            event['arrival_iso'] = None
            event['arrival_status'] = None
            event['late_mins_operator'] = 0
            event['compensation_to_renter_inr'] = 350
            
            notify_clients('operator_events', event)
            
            print(f"✓ Operator {operator_name} accepted request {booking_id}")
            
            found = True
            break
    
    if found:
        return jsonify({
            'success': True, 
            'message': 'Request accepted successfully',
            'event': event
        })
    else:
        print(f"❌ Booking {booking_id} not found")
        return jsonify({
            'success': False, 
            'error': 'Booking not found'
        }), 404


@app.route('/api/operator/reject-request', methods=['POST'])
def reject_request():
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    data = request.json
    booking_id = data.get('booking_id')
    operator_name = session['user']['name']
    
    operator_data = realtime_data.get('operator_events', [])
    realtime_data['operator_events'] = [e for e in operator_data if not (e.get('booking_id') == booking_id)]
    
    print(f"✓ Operator {operator_name} rejected request {booking_id}")
    return jsonify({'success': True, 'message': 'Request rejected'})


@app.route('/api/operator/earnings')
def get_operator_earnings():
    if 'user' not in session:
        return jsonify({'success': False}), 401
    
    operator_name = session['user']['name']
    operator_data = realtime_data.get('operator_events', [])
    operator_filtered = [o for o in operator_data if o.get('operator_name') == operator_name]
    
    print(f"✓ Operator {operator_name} - Total events: {len(operator_filtered)}")
    
    # Calculate earnings from completed assignments
    total_earnings = 0
    on_time_count = 0
    late_count = 0
    
    for event in operator_filtered:
        if event.get('arrival_status') == 'ON_TIME':
            total_earnings += 350
            on_time_count += 1
        elif event.get('arrival_status') == 'LATE':
            penalty = event.get('compensation_to_renter_inr', 0) * 0.3
            earning = max(0, 350 - penalty)
            total_earnings += earning
            late_count += 1
    
    print(f"  ON_TIME: {on_time_count}, LATE: {late_count}, Total Earnings: ₹{total_earnings}")
    
    earnings = {
        'total': total_earnings,
        'this_month': total_earnings * 0.3,
        'this_week': total_earnings * 0.1
    }
    
    return jsonify({'success': True, 'earnings': earnings})


# ==================== RUN ====================


if __name__ == '__main__':
    print("\n" + "="*60)
    print("🛠️  ToolEase Platform Starting...")
    print("="*60)
    print("⏳ Initializing...")
    print("="*60 + "\n")
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)
