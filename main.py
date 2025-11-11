#!/usr/bin/env python3
"""
Tool-Ease CSV publishers
Publishes all renter/owner scenario CSVs to AWS IoT Core on distinct topics.
Compatible with the new UI routes and SSE subscriber.

Folders expected:
  Certificates/
    AmazonRootCA1.pem
    device-cert.crt
    private.pem.key
  Data/
    renter_nearby_tools.csv
    renter_bookings.csv
    renter_operator_events.csv
    renter_feedback.csv
    renter_issues.csv
    owner_revenue.csv
    owner_tool_status.csv
    owner_late_returns.csv
    owner_geofence_breach.csv
"""

import os, time, json, math, threading
import pandas as pd
from distutils.util import strtobool
from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient

# ──────────────────────────────────────────────────────────────────────────────
# 🔧 AWS IoT Core Configuration  (use env vars if present; else defaults)
# ──────────────────────────────────────────────────────────────────────────────
ENDPOINT  = os.getenv("IOT_ENDPOINT",  "a1sktr3so1ji8k-ats.iot.ap-south-1.amazonaws.com")
CLIENT_ID = os.getenv("IOT_CLIENT_ID", "iotconsole-ae9bad38-74c7-4db9-8f84-8b8eafa51b5b")
ROOT_DIR  = os.path.dirname(os.path.abspath(__file__))
CERT_DIR  = os.path.join(ROOT_DIR, "Certificates")
DATA_DIR  = os.path.join(ROOT_DIR,"static", "data")

CA_PATH   = os.getenv("CA_PATH",   os.path.join(CERT_DIR, "AmazonRootCA1.pem"))
CERT_PATH = os.getenv("CERT_PATH", os.path.join(CERT_DIR, "device-cert.crt"))
KEY_PATH  = os.getenv("KEY_PATH",  os.path.join(CERT_DIR, "private.pem.key"))

# ──────────────────────────────────────────────────────────────────────────────
# 🧰 Helpers
# ──────────────────────────────────────────────────────────────────────────────
def safe(v, default=None):
    if v is None: return default
    if isinstance(v, float) and math.isnan(v): return default
    if isinstance(v, str) and v.strip().lower() in ("", "nan", "none", "null"):
        return default
    return v

def to_int(v, default=0):
    try: return int(float(v))
    except Exception: return default

def to_float(v, default=0.0):
    try: return float(v)
    except Exception: return default

def to_bool(v, default=False):
    if isinstance(v, bool): return v
    try: return bool(strtobool(str(v)))
    except Exception: return default

def publish_csv(thread_name, topic, csv_path, transform, delay=0.8):
    """Connect a dedicated MQTT client and publish each CSV row to a topic."""
    if not os.path.exists(csv_path):
        print(f"[{thread_name}] ⚠️ CSV not found: {csv_path}")
        return

    print(f"[{thread_name}] Loading {csv_path}")
    df = pd.read_csv(csv_path, dtype=str)
    print(f"[{thread_name}] ✅ Loaded {len(df)} rows")

    client = AWSIoTMQTTClient(f"{CLIENT_ID}-{thread_name}")
    client.configureEndpoint(ENDPOINT, 8883)
    client.configureCredentials(CA_PATH, KEY_PATH, CERT_PATH)
    client.configureAutoReconnectBackoffTime(1, 32, 20)
    client.configureOfflinePublishQueueing(-1)
    client.configureDrainingFrequency(2)
    client.configureConnectDisconnectTimeout(10)
    client.configureMQTTOperationTimeout(5)

    print(f"[{thread_name}] Connecting MQTT…")
    client.connect()
    print(f"[{thread_name}] 🔗 Connected → {topic}")

    sent = 0
    for _, row in df.iterrows():
        try:
            payload = transform(row)
            # ensure_ascii=False so names show correctly; allow_nan=False for clean JSON
            client.publish(topic, json.dumps(payload, ensure_ascii=False, allow_nan=False), 1)
            sent += 1
            print(f"[{thread_name}] 📤 {topic} : {payload}")
            time.sleep(delay)
        except Exception as e:
            print(f"[{thread_name}] ❌ Publish error: {e}")

    client.disconnect()
    print(f"[{thread_name}] ✅ Done. Published {sent} messages to {topic}")

# ──────────────────────────────────────────────────────────────────────────────
# 🚀 Threads (topics expected by the new UI)
# ──────────────────────────────────────────────────────────────────────────────
threads = [

    # RENTER SIDE
    threading.Thread(target=publish_csv, args=(
        "nearby",
        "renter/nearby_tools",
        os.path.join(DATA_DIR, "renter_nearby_tools.csv"),
        lambda r: {
            "toolid": safe(r["toolid"]),
            "tool_type": safe(r["tool_type"]),
            "latitude": to_float(r["latitude"]),
            "longitude": to_float(r["longitude"]),
            "rating": to_float(r["rating"]),
            "availability": safe(r["availability"]),
            "expected_available_iso": safe(r.get("expected_available_iso")),
            "distance_km_from_user": to_float(r["distance_km_from_user"]),
            "ts_iso": safe(r["ts_iso"])
        }, 0.5)
    ),

    threading.Thread(target=publish_csv, args=(
        "bookings",
        "renter/bookings",
        os.path.join(DATA_DIR, "renter_bookings.csv"),
        lambda r: {
            "booking_id": safe(r["booking_id"]),
            "toolid": safe(r["toolid"]),
            "renter_id": safe(r["renter_id"]),
            "booked_iso": safe(r["booked_iso"]),
            "start_iso": safe(r["start_iso"]),
            "end_iso": safe(r["end_iso"]),
            "operator_requested": to_bool(r["operator_requested"]),
            "payment_status": safe(r["payment_status"]),
            "cancel_status": safe(r["cancel_status"]),
            "amount_inr": to_int(r["amount_inr"]),
            "refund_inr": to_float(r["refund_inr"]),
            "currency": safe(r.get("currency", "INR")),
            "ts_iso": safe(r["ts_iso"])
        }, 0.7)
    ),

    threading.Thread(target=publish_csv, args=(
        "operator",
        "renter/operator_events",
        os.path.join(DATA_DIR, "renter_operator_events.csv"),
        lambda r: {
            "booking_id": safe(r["booking_id"]),
            "toolid": safe(r["toolid"]),
            "operator_assigned": to_bool(r["operator_assigned"]),
            "operator_name": safe(r["operator_name"]),
            "scheduled_iso": safe(r["scheduled_iso"]),
            "arrival_iso": safe(r.get("arrival_iso")),
            "arrival_status": safe(r["arrival_status"]),  # ON_TIME | LATE | ABSENT
            "penalty_to_operator_inr": to_int(r["penalty_to_operator_inr"]),
            "compensation_to_renter_inr": to_int(r["compensation_to_renter_inr"]),
            "ts_iso": safe(r["ts_iso"])
        }, 0.8)
    ),

    threading.Thread(target=publish_csv, args=(
        "feedback",
        "renter/feedback",
        os.path.join(DATA_DIR, "renter_feedback.csv"),
        lambda r: {
            "rental_id": safe(r["rental_id"]),
            "toolid": safe(r["toolid"]),
            "renter_id": safe(r["renter_id"]),
            "rating": to_float(r["rating"]),
            "feedback": safe(r["feedback"]),
            "returned_iso": safe(r["returned_iso"]),
            "damage_flag": to_bool(r["damage_flag"]),
            "ts_iso": safe(r["ts_iso"])
        }, 0.8)
    ),

    threading.Thread(target=publish_csv, args=(
        "issues",
        "renter/issues",
        os.path.join(DATA_DIR, "renter_issues.csv"),
        lambda r: {
            "rental_id": safe(r["rental_id"]),
            "toolid": safe(r["toolid"]),
            "issue_type": safe(r["issue_type"]),
            "severity": safe(r["severity"]),
            "notes": safe(r["notes"]),
            "ts_iso": safe(r["ts_iso"])
        }, 0.9)
    ),

    # OWNER SIDE
    threading.Thread(target=publish_csv, args=(
        "revenue",
        "owner/revenue",
        os.path.join(DATA_DIR, "owner_revenue.csv"),
        lambda r: {
            "toolid": safe(r["toolid"]),
            "period_start_iso": safe(r["period_start_iso"]),
            "period_end_iso": safe(r["period_end_iso"]),
            "rentals_count": to_int(r["rentals_count"]),
            "hours_rented": to_int(r["hours_rented"]),
            "revenue_inr": to_float(r["revenue_inr"]),
            "maintenance_cost_inr": to_float(r["maintenance_cost_inr"]),
            "net_inr": to_float(r["net_inr"]),
            "ts_iso": safe(r["ts_iso"])
        }, 1.0)
    ),

    threading.Thread(target=publish_csv, args=(
        "telemetry",
        "tools/telemetry",
        os.path.join(DATA_DIR, "owner_tool_status.csv"),
        lambda r: {
            "toolid": safe(r["toolid"]),
            "owner_name": safe(r.get("owner_name")),
            "temperature": to_float(r["temperature_c"]),
            "vibration_rms": to_float(r["vibration_rms_g"]),
            "sensor_id": safe(r["sensor_id"]),
            "sensor_status": safe(r["sensor_status"]),
            "hours_since_service": to_float(r["hours_since_service"]),
            "ts_iso": safe(r["ts_iso"])
        }, 0.5)
    ),

    threading.Thread(target=publish_csv, args=(
        "late",
        "tools/late_return",
        os.path.join(DATA_DIR, "owner_late_returns.csv"),
        lambda r: {
            "rental_id": safe(r["rental_id"]),
            "toolid": safe(r["toolid"]),
            "expected_return_iso": safe(r["expected_return_iso"]),
            "actual_return_iso": safe(r["actual_return_iso"]),
            "overdue_hours": to_float(r["overdue_hours"]),
            "extra_charge_inr": to_float(r["extra_charge_inr"]),
            "rate_per_hour": to_int(r["rate_per_hour"]),
            "ts_iso": safe(r["ts_iso"])
        }, 0.9)
    ),

    threading.Thread(target=publish_csv, args=(
        "geofence",
        "tools/geofence",
        os.path.join(DATA_DIR, "owner_geofence_breach.csv"),
        lambda r: {
            "toolid": safe(r["toolid"]),
            "latitude": to_float(r["latitude"]),
            "longitude": to_float(r["longitude"]),
            "geofence_id": safe(r["geofence_id"]),
            "breach_type": safe(r["breach_type"]),   # inside | exit
            "distance_m": to_float(r.get("distance_m", 0)),
            "ts_iso": safe(r["ts_iso"])
        }, 1.0)
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# 🏁 Run all publishers
# ──────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("🚀 Starting Tool-Ease CSV → IoT Core publishers…")
    for t in threads: t.start()
    for t in threads: t.join()
    print("✅ All CSVs published.")
