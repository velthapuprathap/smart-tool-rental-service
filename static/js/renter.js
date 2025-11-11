// ==================== RENTER DASHBOARD FUNCTIONALITY ====================

let allNearbyTools = [];
let myBookings = [];
let operatorTracking = [];
let currentBookingTool = null;
let pendingBookingData = null;
let allFeedback = [];
let pendingFeedback = [];
let currentFeedbackBooking = null;

// ==================== NAVIGATION ====================

function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    document.getElementById(sectionId).classList.add('active');
    
    const navItem = document.querySelector(`a[href="#${sectionId}"]`);
    if (navItem) {
        navItem.classList.add('active');
    }
}

// ==================== LOAD NEARBY TOOLS ====================

async function loadNearbyTools() {
    try {
        const response = await fetch('/api/renter/nearby-tools');
        const result = await response.json();
        
        if (result.success) {
            allNearbyTools = result.tools;
            console.log('Loaded tools:', allNearbyTools.length);
            displayNearbyTools(allNearbyTools);
        } else {
            console.error('Failed to load tools');
        }
    } catch (error) {
        console.error('Error loading nearby tools:', error);
    }
}

function displayNearbyTools(tools) {
    const container = document.getElementById('toolsGrid');
    
    if (!tools || tools.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                <span style="font-size: 64px;">🔧</span>
                <h3>No Tools Available</h3>
                <p style="color: var(--text-secondary);">Check back later for available tools</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = tools.map(tool => `
        <div class="tool-card">
            ${tool.tool_image ? `
                <div class="tool-image-container">
                    <img src="${tool.tool_image}" alt="${tool.tool_type || 'Tool'}" class="tool-image" onerror="this.src='/static/images/tools/drill.png'">
                    <span class="status-badge-overlay ${getStatusBadgeClass(tool.availability)}">${tool.availability}</span>
                </div>
            ` : ''}
            
            <div class="tool-header">
                <div class="tool-title">
                    <h3>${tool.tool_type || 'Tool'}</h3>
                    <span class="tool-id">${tool.toolid}</span>
                </div>
            </div>
            
            <div class="tool-info">
                <div class="info-row">
                    <span class="info-label">⭐ Rating</span>
                    <span class="info-value">${tool.rating ? tool.rating.toFixed(1) : 'N/A'}/5.0</span>
                </div>
                <div class="info-row">
                    <span class="info-label">📍 Distance</span>
                    <span class="info-value">${tool.distance_km_from_user ? tool.distance_km_from_user.toFixed(2) : 'N/A'} km</span>
                </div>
                <div class="info-row">
                    <span class="info-label">💰 Hourly Rate</span>
                    <span class="info-value">₹${tool.hourly_rate || 150}/hr</span>
                </div>
                <div class="info-row">
                    <span class="info-label">💰 Daily Rate</span>
                    <span class="info-value">₹${tool.daily_rate || 1000}/day</span>
                </div>
                ${tool.availability === 'BOOKED' && tool.expected_available_iso ? `
                    <div class="info-row">
                        <span class="info-label">📅 Available On</span>
                        <span class="info-value">${formatDate(tool.expected_available_iso)}</span>
                    </div>
                ` : ''}
            </div>
            
            <div class="tool-actions">
                ${tool.availability === 'AVAILABLE' ? `
                    <button class="btn-primary" style="width: 100%;" onclick="openBookingModal('${tool.toolid}')">
                        📦 Book Now
                    </button>
                ` : tool.availability === 'BOOKED' ? `
                    <button class="btn-secondary" style="width: 100%;" disabled>
                        Currently Booked
                    </button>
                ` : `
                    <button class="btn-secondary" style="width: 100%;" disabled>
                        Under Maintenance
                    </button>
                `}
            </div>
        </div>
    `).join('');
}


function getStatusBadgeClass(availability) {
    switch(availability) {
        case 'AVAILABLE': return 'available';
        case 'BOOKED': return 'booked';
        case 'MAINTENANCE': return 'maintenance';
        default: return 'booked';
    }
}

// ==================== FILTERS ====================

function applyFilters() {
    const availabilityFilter = document.getElementById('availabilityFilter').value;
    const distanceFilter = parseFloat(document.getElementById('distanceFilter').value);
    const ratingFilter = parseFloat(document.getElementById('ratingFilter').value);
    
    let filtered = [...allNearbyTools];
    
    if (availabilityFilter !== 'all') {
        filtered = filtered.filter(t => t.availability === availabilityFilter);
    }
    
    if (!isNaN(distanceFilter)) {
        filtered = filtered.filter(t => (t.distance_km_from_user || 0) <= distanceFilter);
    }
    
    if (!isNaN(ratingFilter)) {
        filtered = filtered.filter(t => (t.rating || 0) >= ratingFilter);
    }
    
    displayNearbyTools(filtered);
}

function filterTools() {
    const searchTerm = document.getElementById('searchTools').value.toLowerCase();
    const filtered = allNearbyTools.filter(tool => 
        (tool.tool_type || '').toLowerCase().includes(searchTerm) ||
        (tool.toolid || '').toLowerCase().includes(searchTerm)
    );
    displayNearbyTools(filtered);
}

// ==================== BOOKING ====================

function openBookingModal(toolId) {
    const tool = allNearbyTools.find(t => t.toolid === toolId);
    if (!tool) {
        showNotification('Tool not found', 'error');
        return;
    }
    
    currentBookingTool = tool;
    
    document.getElementById('bookingToolDetails').innerHTML = `
        <div style="padding: 20px; background: var(--bg-secondary); border-radius: 10px; margin-bottom: 20px;">
            <h3>${tool.tool_type} - ${tool.toolid}</h3>
            <div style="margin-top: 10px; display: grid; gap: 8px;">
                <p><strong>⭐ Rating:</strong> ${tool.rating ? tool.rating.toFixed(1) : 'N/A'}/5.0</p>
                <p><strong>📍 Distance:</strong> ${tool.distance_km_from_user ? tool.distance_km_from_user.toFixed(2) : 'N/A'} km away</p>
                <p><strong>💰 Rates:</strong> ₹${tool.hourly_rate}/hr | ₹${tool.daily_rate}/day</p>
            </div>
        </div>
    `;
    
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const minDateTime = now.toISOString().slice(0, 16);
    document.querySelector('input[name="start_date"]').min = minDateTime;
    document.querySelector('input[name="start_date"]').value = minDateTime;
    
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
    document.querySelector('input[name="end_date"]').min = minDateTime;
    document.querySelector('input[name="end_date"]').value = tomorrow.toISOString().slice(0, 16);
    
    document.getElementById('bookingModal').style.display = 'flex';
    calculatePrice();
}

function closeBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    const form = document.getElementById('bookingForm');
    if (form) {
        form.reset();
    }
    
    currentBookingTool = null;
    console.log('✓ Booking modal closed');
}

function calculatePrice() {
    if (!currentBookingTool) return;
    
    const startDate = document.querySelector('input[name="start_date"]').value;
    const endDate = document.querySelector('input[name="end_date"]').value;
    const durationType = document.getElementById('durationType').value;
    const operatorNeeded = document.getElementById('operatorNeeded').checked;
    
    if (!startDate || !endDate) {
        document.getElementById('toolPrice').textContent = '₹0';
        document.getElementById('operatorPrice').textContent = '₹0';
        document.getElementById('totalPrice').textContent = '₹0';
        return;
    }
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = end - start;
    
    if (diffMs <= 0) {
        showNotification('End date must be after start date', 'error');
        return;
    }
    
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    
    let toolPrice = 0;
    if (durationType === 'hourly') {
        toolPrice = diffHours * (currentBookingTool.hourly_rate || 150);
    } else {
        toolPrice = Math.ceil(diffDays) * (currentBookingTool.daily_rate || 1000);
    }
    
    const operatorPrice = operatorNeeded ? (Math.ceil(diffDays) * 500) : 0;
    const totalPrice = toolPrice + operatorPrice;
    
    document.getElementById('toolPrice').textContent = `₹${toolPrice.toFixed(2)}`;
    document.getElementById('operatorPrice').textContent = `₹${operatorPrice.toFixed(2)}`;
    document.getElementById('totalPrice').textContent = `₹${totalPrice.toFixed(2)}`;
}

async function handleBooking(event) {
    event.preventDefault();
    
    if (!currentBookingTool) {
        showNotification('No tool selected', 'error');
        return;
    }
    
    const formData = new FormData(event.target);
    const totalAmount = parseFloat(document.getElementById('totalPrice').textContent.replace('₹', ''));
    
    if (totalAmount <= 0) {
        showNotification('Invalid booking amount', 'error');
        return;
    }
    
    const bookingData = {
        tool_id: currentBookingTool.toolid,
        tool_name: currentBookingTool.tool_type || currentBookingTool.tool_name || 'Tool',
        start_date: formData.get('start_date'),
        end_date: formData.get('end_date'),
        operator_needed: formData.get('operator_needed') === 'on',
        amount: totalAmount,
        geo_lat: currentBookingTool.latitude || 17.385044,
        geo_lng: currentBookingTool.longitude || 78.486671
    };
    
    showPaymentGateway(bookingData);
}

// ==================== PAYMENT GATEWAY ====================

function showPaymentGateway(bookingData) {
    pendingBookingData = bookingData;
    console.log('✓ Stored booking data:', pendingBookingData);
    
    const modal = document.createElement('div');
    modal.className = 'payment-modal';
    modal.id = 'paymentModal';
    modal.innerHTML = `
        <div class="payment-modal-overlay" onclick="closePaymentModal()"></div>
        <div class="payment-modal-content">
            <div class="payment-header">
                <h2>💳 Complete Payment</h2>
                <button class="close-btn" onclick="closePaymentModal()">✕</button>
            </div>
            
            <div class="payment-summary">
                <h3>Payment Summary</h3>
                <div class="summary-row">
                    <span>Tool Rental</span>
                    <span>₹${(bookingData.amount - (bookingData.operator_needed ? 1500 : 0)).toFixed(2)}</span>
                </div>
                ${bookingData.operator_needed ? `
                    <div class="summary-row">
                        <span>Operator Fee</span>
                        <span>₹1500.00</span>
                    </div>
                ` : ''}
                <div class="summary-row total">
                    <span><strong>Total Amount</strong></span>
                    <span><strong>₹${bookingData.amount.toFixed(2)}</strong></span>
                </div>
            </div>
            
            <div class="payment-methods">
                <h3>Select Payment Method</h3>
                
                <div class="payment-option" onclick="selectPaymentMethod('upi')">
                    <div class="payment-option-content">
                        <div class="payment-icon">📱</div>
                        <div class="payment-info">
                            <h4>UPI</h4>
                            <p>Google Pay, PhonePe, Paytm, BHIM</p>
                        </div>
                    </div>
                    <div class="payment-radio">
                        <input type="radio" name="payment_method" value="upi" id="upi">
                    </div>
                </div>
                
                <div class="payment-option" onclick="selectPaymentMethod('card')">
                    <div class="payment-option-content">
                        <div class="payment-icon">💳</div>
                        <div class="payment-info">
                            <h4>Debit / Credit Card</h4>
                            <p>Visa, Mastercard, Rupay, Amex</p>
                        </div>
                    </div>
                    <div class="payment-radio">
                        <input type="radio" name="payment_method" value="card" id="card">
                    </div>
                </div>
                
                <div class="payment-option" onclick="selectPaymentMethod('netbanking')">
                    <div class="payment-option-content">
                        <div class="payment-icon">🏦</div>
                        <div class="payment-info">
                            <h4>Net Banking</h4>
                            <p>All Indian Banks</p>
                        </div>
                    </div>
                    <div class="payment-radio">
                        <input type="radio" name="payment_method" value="netbanking" id="netbanking">
                    </div>
                </div>
                
                <div class="payment-option" onclick="selectPaymentMethod('wallet')">
                    <div class="payment-option-content">
                        <div class="payment-icon">👛</div>
                        <div class="payment-info">
                            <h4>Wallets</h4>
                            <p>Paytm, PhonePe, Amazon Pay</p>
                        </div>
                    </div>
                    <div class="payment-radio">
                        <input type="radio" name="payment_method" value="wallet" id="wallet">
                    </div>
                </div>
            </div>
            
            <div id="paymentDetails"></div>
            
            <button class="btn-primary" style="width: 100%; margin-top: 20px; padding: 15px; font-size: 16px;" 
                    onclick="processPayment()" id="payBtn" disabled>
                🔒 Pay ₹${bookingData.amount.toFixed(2)}
            </button>
            
            <p style="text-align: center; margin-top: 15px; font-size: 13px; color: var(--text-secondary);">
                🔒 Secure payment powered by ToolEase
            </p>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if (modal) {
        modal.remove();
    }
    console.log('✓ Payment modal closed');
}

function selectPaymentMethod(method) {
    document.getElementById(method).checked = true;
    document.getElementById('payBtn').disabled = false;
    
    document.querySelectorAll('.payment-option').forEach(opt => {
        opt.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    const detailsContainer = document.getElementById('paymentDetails');
    
    if (method === 'upi') {
        detailsContainer.innerHTML = `
            <div class="payment-input-group">
                <label>Enter UPI ID</label>
                <input type="text" placeholder="example@upi" id="upiId" class="payment-input">
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">
                    We will send a payment request to your UPI app
                </p>
            </div>
        `;
    } else if (method === 'card') {
        detailsContainer.innerHTML = `
            <div class="payment-input-group">
                <label>Card Number</label>
                <input type="text" placeholder="1234 5678 9012 3456" maxlength="19" id="cardNumber" class="payment-input">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                    <div>
                        <label>Expiry Date</label>
                        <input type="text" placeholder="MM/YY" maxlength="5" id="cardExpiry" class="payment-input">
                    </div>
                    <div>
                        <label>CVV</label>
                        <input type="password" placeholder="123" maxlength="3" id="cardCVV" class="payment-input">
                    </div>
                </div>
            </div>
        `;
    } else if (method === 'netbanking') {
        detailsContainer.innerHTML = `
            <div class="payment-input-group">
                <label>Select Your Bank</label>
                <select id="bankSelect" class="payment-input">
                    <option value="">Choose Bank</option>
                    <option value="sbi">State Bank of India</option>
                    <option value="hdfc">HDFC Bank</option>
                    <option value="icici">ICICI Bank</option>
                    <option value="axis">Axis Bank</option>
                    <option value="pnb">Punjab National Bank</option>
                    <option value="bob">Bank of Baroda</option>
                    <option value="kotak">Kotak Mahindra Bank</option>
                </select>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">
                    You will be redirected to your bank's website
                </p>
            </div>
        `;
    } else if (method === 'wallet') {
        detailsContainer.innerHTML = `
            <div class="payment-input-group">
                <label>Select Wallet</label>
                <select id="walletSelect" class="payment-input">
                    <option value="">Choose Wallet</option>
                    <option value="paytm">Paytm Wallet</option>
                    <option value="phonepe">PhonePe Wallet</option>
                    <option value="amazonpay">Amazon Pay</option>
                    <option value="mobikwik">Mobikwik</option>
                </select>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">
                    You will be redirected to complete payment
                </p>
            </div>
        `;
    }
}

function processPayment() {
    const selectedMethod = document.querySelector('input[name="payment_method"]:checked');
    
    if (!selectedMethod) {
        showNotification('Please select a payment method', 'error');
        return;
    }
    
    if (!pendingBookingData) {
        showNotification('Booking data not found. Please try again.', 'error');
        console.error('❌ No pending booking data!');
        return;
    }
    
    const payBtn = document.getElementById('payBtn');
    payBtn.disabled = true;
    payBtn.innerHTML = '⏳ Processing Payment...';
    
    console.log('Processing payment for:', pendingBookingData);
    
    setTimeout(() => {
        payBtn.innerHTML = '✅ Payment Successful!';
        payBtn.style.background = '#10b981';
        
        setTimeout(() => {
            closePaymentModal();
            completeBooking(pendingBookingData);
        }, 1500);
    }, 2000);
}

function completeBooking(bookingData) {
    console.log('Completing booking with data:', bookingData);
    
    if (!bookingData) {
        showNotification('Booking data not found. Please try again.', 'error');
        console.error('❌ No booking data provided!');
        return;
    }
    
    fetch('/api/renter/book-tool', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(bookingData)
    })
    .then(response => {
        console.log('Server response status:', response.status);
        return response.json();
    })
    .then(result => {
        console.log('Booking result:', result);
        
        if (result.success) {
            pendingBookingData = null;
            closeBookingModal();
            showNotification(`✅ ${bookingData.tool_name || 'Tool'} booked successfully!`, 'success');
            
            loadMyBookings();
            loadNearbyTools();
            
            setTimeout(() => {
                showSection('my-bookings');
            }, 800);
        } else {
            showNotification('Booking failed: ' + (result.error || 'Unknown error'), 'error');
            console.error('Booking failed:', result);
        }
    })
    .catch(error => {
        console.error('Booking error:', error);
        showNotification('Booking failed. Please try again.', 'error');
    });
}

// ==================== MY BOOKINGS ====================

async function loadMyBookings() {
    try {
        const response = await fetch('/api/renter/bookings');
        const result = await response.json();
        
        if (result.success) {
            myBookings = result.bookings;
            console.log('Loaded bookings:', myBookings.length);
            displayMyBookings(myBookings);
            displayRecentBookings(myBookings.slice(0, 5));
        }
    } catch (error) {
        console.error('Error loading bookings:', error);
    }
}

function displayMyBookings(bookings) {
    const container = document.getElementById('bookingsList');
    
    if (!bookings || bookings.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <span style="font-size: 64px;">📋</span>
                <h3>No Bookings Yet</h3>
                <p style="color: var(--text-secondary);">Your booked tools will appear here</p>
                <button class="btn-primary" style="margin-top: 20px;" onclick="showSection('browse-tools')">Browse Tools</button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = bookings.map(booking => {
        const toolName = booking.tool_name || booking.tool_type || 'Tool';
        const toolId = booking.toolid;
        const bookingId = booking.booking_id;
        
        return `
            <div class="booking-card">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                    <div>
                        <h2 style="font-size: 22px; margin: 0 0 8px 0; color: var(--primary-color); font-weight: 700;">
                            ${toolName}
                        </h2>
                        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                            <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">
                                <strong>Tool ID:</strong> ${toolId}
                            </p>
                            <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">
                                <strong>Booking:</strong> ${bookingId}
                            </p>
                        </div>
                    </div>
                    <span class="status-badge ${getPaymentStatusClass(booking.payment_status)}">
                        ${booking.payment_status}
                    </span>
                </div>
                
                <div class="tool-info">
                    <div class="info-row">
                        <span class="info-label">📅 Booked On</span>
                        <span class="info-value">${formatDateTime(booking.booked_iso)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">⏰ Start Time</span>
                        <span class="info-value">${formatDateTime(booking.rental_start_iso)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">⏰ End Time</span>
                        <span class="info-value">${formatDateTime(booking.rental_end_iso)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">💰 Amount</span>
                        <span class="info-value"><strong>₹${booking.amount_inr}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">👷 Operator</span>
                        <span class="info-value">${booking.operator_requested ? '✅ Requested' : '❌ Not Requested'}</span>
                    </div>
                    ${booking.cancel_status && booking.cancel_status !== 'NONE' ? `
                        <div class="info-row">
                            <span class="info-label">❌ Status</span>
                            <span class="info-value" style="color: red;">${booking.cancel_status}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function getPaymentStatusClass(status) {
    switch(status) {
        case 'SUCCESS': return 'available';
        case 'PENDING': return 'booked';
        case 'FAILED_USER':
        case 'FAILED_SERVER': return 'danger';
        default: return 'booked';
    }
}

function displayRecentBookings(bookings) {
    const container = document.getElementById('recentBookings');
    if (!container) return;
    
    if (!bookings || bookings.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No recent bookings</p>';
        return;
    }
    
    container.innerHTML = bookings.map(booking => `
        <div class="activity-item">
            <div>
                <strong>${booking.toolid}</strong>
                <p style="font-size: 13px; color: var(--text-secondary)">₹${booking.amount_inr}</p>
            </div>
            <span class="activity-time">${formatDate(booking.booked_iso)}</span>
        </div>
    `).join('');
}

function filterBookings() {
    const statusFilter = document.getElementById('bookingStatusFilter').value;
    
    if (statusFilter === 'all') {
        displayMyBookings(myBookings);
    } else {
        const filtered = myBookings.filter(b => b.payment_status === statusFilter);
        displayMyBookings(filtered);
    }
}

// ==================== OPERATOR TRACKING ====================

async function loadOperatorTracking() {
    try {
        const response = await fetch('/api/renter/operator-tracking');
        const result = await response.json();
        
        if (result.success) {
            operatorTracking = result.data;
            displayOperatorTracking(operatorTracking);
        }
    } catch (error) {
        console.error('Error loading operator tracking:', error);
    }
}

function displayOperatorTracking(data) {
    const container = document.getElementById('operatorTrackingList');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span style="font-size: 64px;">📍</span>
                <h3>No Operator Assignments</h3>
                <p>Operator tracking will appear here when you book with operator service</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = data.map(op => `
        <div class="tracking-card">
            <div class="tracking-header">
                <div>
                    <h3>Booking: ${op.booking_id}</h3>
                    <p style="color: #64748b;">Tool: ${op.toolid}</p>
                </div>
                <span class="status-badge ${op.arrival_iso ? 'available' : 'pending'}">
                    ${op.arrival_iso ? 'ARRIVED' : 'PENDING'}
                </span>
            </div>
            
            <div class="tracking-info">
                <div class="info-row">
                    <span class="info-label">👷 Operator</span>
                    <span class="info-value"><strong>${op.operator_name || 'Not Assigned'}</strong></span>
                </div>
                
                <div class="info-row">
                    <span class="info-label">📅 Expected Arrival</span>
                    <span class="info-value">${formatDateTime(op.expected_arrival_iso)}</span>
                </div>
                
                ${op.arrival_iso ? `
                    <div class="info-row">
                        <span class="info-label">✅ Actual Arrival</span>
                        <span class="info-value">${formatDateTime(op.arrival_iso)}</span>
                    </div>
                    
                    <div class="info-row">
                        <span class="info-label">⏱️ Status</span>
                        <span class="info-value ${op.arrival_status === 'ON_TIME' ? 'text-success' : 'text-warning'}">
                            ${op.arrival_status === 'ON_TIME' ? '✓ On Time' : '⚠️ Late by ' + op.late_mins_operator + ' mins'}
                        </span>
                    </div>
                ` : `
                    <div class="info-row">
                        <span class="info-label">⏳ Status</span>
                        <span class="info-value" style="color: #f59e0b;">Operator en route...</span>
                    </div>
                `}
                
                ${op.compensation_to_renter_inr > 0 ? `
                    <div class="info-row">
                        <span class="info-label">💰 Compensation</span>
                        <span class="info-value text-success"><strong>₹${op.compensation_to_renter_inr}</strong></span>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function trackOperatorLocation(bookingId) {
    showNotification('Opening map to track operator...', 'info');
}

// ==================== FEEDBACK SECTION ====================

async function loadFeedback() {
    try {
        const response = await fetch('/api/renter/feedback');
        const result = await response.json();
        
        if (result.success) {
            allFeedback = result.feedback || [];
            pendingFeedback = result.pending || [];
            console.log('Loaded feedback:', allFeedback.length, 'Pending:', pendingFeedback.length);
            displayPendingFeedback();
            displayFeedback(allFeedback);
        }
    } catch (error) {
        console.error('Error loading feedback:', error);
    }
}

function displayPendingFeedback() {
    const countEl = document.getElementById('pendingFeedbackCount');
    const listEl = document.getElementById('pendingFeedbackList');
    
    if (!pendingFeedback || pendingFeedback.length === 0) {
        countEl.textContent = '0';
        listEl.innerHTML = '<p style="margin: 0; opacity: 0.9;">No pending feedback. Great job! 🎉</p>';
        return;
    }
    
    countEl.textContent = pendingFeedback.length;
    listEl.innerHTML = pendingFeedback.map(booking => `
        <div class="pending-feedback-item">
            <div class="pending-tool-info">
                <h4>${booking.tool_name || booking.tool_type || 'Tool'} - ${booking.toolid}</h4>
                <p>Returned on ${formatDateTime(booking.returned_iso || booking.rental_end_iso)}</p>
            </div>
            <button onclick="openFeedbackModal('${booking.booking_id}')">
                ✍️ Write Review
            </button>
        </div>
    `).join('');
}

function displayFeedback(feedbackList) {
    const container = document.getElementById('feedbackList');
    
    if (!feedbackList || feedbackList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span style="font-size: 64px;">📝</span>
                <h3>No Feedback Yet</h3>
                <p>Your submitted reviews will appear here</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = feedbackList.map(feedback => {
        const stars = '★'.repeat(Math.floor(feedback.rating)) + '☆'.repeat(5 - Math.floor(feedback.rating));
        
        return `
            <div class="feedback-card">
                <div class="feedback-header">
                    <div class="feedback-tool-info">
                        <h3>${feedback.tool_name || feedback.tool_type || 'Tool'}</h3>
                        <p>Tool ID: ${feedback.toolid} • Booking: ${feedback.rentalid}</p>
                    </div>
                    <div class="feedback-rating">
                        <span class="star-display">${stars}</span>
                        <span class="rating-number">${feedback.rating.toFixed(1)}</span>
                    </div>
                </div>
                
                <div class="feedback-content">
                    ${feedback.feedback || 'No detailed feedback provided'}
                </div>
                
                <div class="feedback-meta">
                    <span>Submitted on ${formatDateTime(feedback.tsiso)}</span>
                    ${feedback.damageflag ? '<span class="damage-badge">⚠️ Damage Reported</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
}

function filterFeedback() {
    const filterValue = document.getElementById('feedbackFilter').value;
    
    if (filterValue === 'all') {
        displayFeedback(allFeedback);
    } else {
        const rating = parseInt(filterValue);
        const filtered = allFeedback.filter(f => Math.floor(f.rating) === rating);
        displayFeedback(filtered);
    }
}

function openFeedbackModal(bookingId) {
    const booking = pendingFeedback.find(b => b.booking_id === bookingId);
    if (!booking) {
        showNotification('Booking not found', 'error');
        return;
    }
    
    currentFeedbackBooking = booking;
    
    document.getElementById('feedbackToolName').textContent = 
        `${booking.tool_name || booking.tool_type || 'Tool'} - ${booking.toolid}`;
    
    document.getElementById('feedbackToolDetails').innerHTML = `
        <div style="display: grid; gap: 10px;">
            <p><strong>📦 Tool:</strong> ${booking.tool_name || booking.tool_type || 'Tool'}</p>
            <p><strong>🆔 Booking ID:</strong> ${booking.booking_id}</p>
            <p><strong>📅 Rental Period:</strong> ${formatDate(booking.rental_start_iso)} - ${formatDate(booking.rental_end_iso)}</p>
            <p><strong>💰 Amount Paid:</strong> ₹${booking.amount_inr}</p>
        </div>
    `;
    
    // Reset form
    document.getElementById('feedbackForm').reset();
    document.getElementById('ratingValue').value = '';
    document.getElementById('ratingText').textContent = '';
    document.querySelectorAll('.star').forEach(star => star.classList.remove('active'));
    document.querySelectorAll('.feedback-tag').forEach(tag => tag.classList.remove('active'));
    
    // Initialize star rating
    initializeStarRating();
    
    document.getElementById('feedbackModal').style.display = 'flex';
}

function closeFeedbackModal() {
    document.getElementById('feedbackModal').style.display = 'none';
    currentFeedbackBooking = null;
}

function initializeStarRating() {
    const stars = document.querySelectorAll('.star');
    const ratingInput = document.getElementById('ratingValue');
    const ratingText = document.getElementById('ratingText');
    
    const ratingLabels = {
        1: '⭐ Poor',
        2: '⭐⭐ Fair',
        3: '⭐⭐⭐ Good',
        4: '⭐⭐⭐⭐ Very Good',
        5: '⭐⭐⭐⭐⭐ Excellent'
    };
    
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const rating = parseInt(this.getAttribute('data-rating'));
            ratingInput.value = rating;
            ratingText.textContent = ratingLabels[rating];
            
            stars.forEach((s, index) => {
                if (index < rating) {
                    s.classList.add('active');
                    s.textContent = '★';
                } else {
                    s.classList.remove('active');
                    s.textContent = '☆';
                }
            });
        });
        
        star.addEventListener('mouseenter', function() {
            const rating = parseInt(this.getAttribute('data-rating'));
            stars.forEach((s, index) => {
                s.textContent = index < rating ? '★' : '☆';
            });
        });
    });
    
    const container = document.getElementById('starRating');
    container.addEventListener('mouseleave', function() {
        const currentRating = parseInt(ratingInput.value) || 0;
        stars.forEach((s, index) => {
            s.textContent = index < currentRating ? '★' : '☆';
        });
    });
}

function toggleFeedbackTag(button) {
    button.classList.toggle('active');
}

async function submitFeedback(event) {
    event.preventDefault();
    
    if (!currentFeedbackBooking) {
        showNotification('No booking selected', 'error');
        return;
    }
    
    const formData = new FormData(event.target);
    const rating = parseFloat(formData.get('rating'));
    
    if (!rating || rating < 1 || rating > 5) {
        showNotification('Please select a star rating', 'error');
        return;
    }
    
    const selectedTags = Array.from(document.querySelectorAll('.feedback-tag.active'))
        .map(tag => tag.textContent.trim())
        .join(', ');
    
    let feedbackText = formData.get('feedback').trim();
    if (selectedTags) {
        feedbackText = `[${selectedTags}] ${feedbackText}`;
    }
    
    const feedbackData = {
        booking_id: currentFeedbackBooking.booking_id,
        tool_id: currentFeedbackBooking.toolid,
        rating: rating,
        feedback: feedbackText,
        damage_flag: formData.get('damage_flag') === 'on'
    };
    
    console.log('Submitting feedback:', feedbackData);
    
    try {
        const response = await fetch('/api/renter/feedback', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(feedbackData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('✅ Thank you for your feedback!', 'success');
            closeFeedbackModal();
            loadFeedback();
        } else {
            showNotification('Failed to submit feedback: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error submitting feedback:', error);
        showNotification('Failed to submit feedback. Please try again.', 'error');
    }
}

// ==================== UTILITY FUNCTIONS ====================

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-IN');
}

function formatDateTime(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString('en-IN', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// ==================== AUTO-REFRESH FOR REAL-TIME DATA ====================

setInterval(() => {
    const currentSection = document.querySelector('.content-section.active');
    if (!currentSection) return;
    
    const sectionId = currentSection.id;
    
    if (sectionId === 'browse-tools') {
        loadNearbyTools();
    }
    if (sectionId === 'my-bookings') {
        loadMyBookings();
    }
    if (sectionId === 'operator-tracking') {
        loadOperatorTracking();
    }
    if (sectionId === 'feedback-section') {
        loadFeedback();
    }
}, 15000);

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    console.log('✓ Renter dashboard initialized');
    loadNearbyTools();
    loadMyBookings();
    loadOperatorTracking();
    loadFeedback();
});
