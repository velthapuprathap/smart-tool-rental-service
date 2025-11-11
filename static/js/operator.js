// ==================== OPERATOR DASHBOARD FUNCTIONALITY ====================

let pendingRequests = [];
let myAssignments = [];
let earningsData = null;
let navigationMap = null;

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
    
    if (sectionId === 'navigation') {
        setTimeout(() => {
            if (navigationMap) {
                navigationMap.invalidateSize();
            }
        }, 100);
    }
}

// ==================== LOAD REQUESTS ====================

async function loadRequests() {
    try {
        const response = await fetch('/api/operator/requests');
        const result = await response.json();
        
        if (result.success) {
            pendingRequests = result.requests;
            console.log('✓ Loaded pending requests:', pendingRequests.length);
            displayRequests(pendingRequests);
            updateRequestCount(pendingRequests.length);
        }
    } catch (error) {
        console.error('Error loading requests:', error);
        showNotification('Failed to load requests', 'error');
    }
}

function displayRequests(requests) {
    const container = document.getElementById('requestsList');
    
    if (!requests || requests.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span style="font-size: 64px;">📋</span>
                <h3>No Pending Requests</h3>
                <p>New operator requests will appear here</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = requests.map(request => `
        <div class="request-card">
            ${request.tool_image ? `
                <div class="tool-image-container-small">
                    <img src="${request.tool_image}" alt="${request.tool_type || 'Tool'}" class="tool-image-small" onerror="this.src='/static/images/tools/drill.png'">
                </div>
            ` : ''}
            
            <div class="request-info">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div>
                        <h3 style="margin: 0 0 5px 0;">${request.tool_name || request.tool_type || 'Tool'}</h3>
                        <p style="margin: 0; color: var(--text-secondary); font-size: 13px;">
                            ID: ${request.toolid} • Booking: ${request.booking_id}
                        </p>
                    </div>
                </div>
                
                <div class="info-row">
                    <span class="info-label">📍 Location</span>
                    <span class="info-value">${request.location_name || 'Location not specified'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">⏰ Expected Arrival</span>
                    <span class="info-value">${formatDateTime(request.expected_arrival_iso)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">💰 Estimated Earnings</span>
                    <span class="info-value"><strong>₹${request.estimated_earnings || 350}</strong></span>
                </div>
            </div>
            
            <div class="request-actions">
                <button class="btn-primary" style="flex: 1;" onclick="acceptRequest('${request.booking_id}')">
                    ✅ Accept
                </button>
                <button class="btn-secondary" style="flex: 1;" onclick="rejectRequest('${request.booking_id}')">
                    ❌ Reject
                </button>
            </div>
        </div>
    `).join('');
}


function updateRequestCount(count) {
    const badge = document.getElementById('requestCount');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

async function acceptRequest(bookingId) {
    try {
        const response = await fetch('/api/operator/accept-request', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ booking_id: bookingId })
        });
        
        const result = await response.json();
        
        console.log('Accept response:', result);
        
        if (result.success) {
            showNotification('Request accepted successfully! ✅', 'success');
            
            pendingRequests = pendingRequests.filter(r => r.booking_id !== bookingId);
            displayRequests(pendingRequests);
            updateRequestCount(pendingRequests.length);
            
            setTimeout(() => {
                loadAssignments();
                loadEarnings();
                showSection('assignments');
            }, 1000);
        } else {
            console.error('Accept failed:', result.error);
            showNotification(`Failed to accept: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error accepting request:', error);
        showNotification('Network error: ' + error.message, 'error');
    }
}

async function rejectRequest(bookingId) {
    if (!confirm('Are you sure you want to reject this request?')) {
        return;
    }
    
    try {
        const response = await fetch('/api/operator/reject-request', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ booking_id: bookingId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Request rejected', 'info');
            pendingRequests = pendingRequests.filter(r => r.booking_id !== bookingId);
            displayRequests(pendingRequests);
            updateRequestCount(pendingRequests.length);
        }
    } catch (error) {
        console.error('Error rejecting request:', error);
    }
}

// ==================== LOAD ASSIGNMENTS ====================

async function loadAssignments() {
    try {
        const response = await fetch('/api/operator/assignments');
        const result = await response.json();
        
        if (result.success) {
            myAssignments = result.assignments;
            console.log('✓ Loaded assignments:', myAssignments.length);
            displayAssignments(myAssignments);
            displayTodaySchedule(myAssignments);
            loadNavigationAssignments(); // ✅ ADD THIS LINE
            loadEarnings();
        }
    } catch (error) {
        console.error('Error loading assignments:', error);
    }
}


function displayAssignments(assignments) {
    const container = document.getElementById('assignmentsList');
    
    if (!assignments || assignments.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span style="font-size: 64px;">📦</span>
                <h3>No Active Assignments</h3>
                <p>Your accepted assignments will appear here</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = assignments.map(assignment => {
        const isCompleted = assignment.arrival_iso !== null;
        const isPending = !assignment.arrival_iso && assignment.accepted_iso;
        
        return `
            <div class="assignment-card">
                ${assignment.tool_image ? `
                    <div class="tool-image-container-small">
                        <img src="${assignment.tool_image}" alt="${assignment.tool_type || 'Tool'}" class="tool-image-small" onerror="this.src='/static/images/tools/drill.png'">
                        ${isCompleted ? '<div class="completed-badge">✓ COMPLETED</div>' : 
                          isPending ? '<div class="pending-badge">⏳ UPCOMING</div>' : ''}
                    </div>
                ` : ''}
                
                <div class="assignment-info">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                        <div>
                            <h3 style="margin: 0 0 5px 0;">${assignment.tool_name || assignment.tool_type || 'Tool'}</h3>
                            <p style="margin: 0; color: var(--text-secondary); font-size: 13px;">
                                ID: ${assignment.toolid} • Booking: ${assignment.booking_id}
                            </p>
                        </div>
                        ${isCompleted ? `
                            <span class="status-badge ${assignment.arrival_status === 'ON_TIME' ? 'available' : 'warning'}">
                                ${assignment.arrival_status === 'ON_TIME' ? '✓ On Time' : '⚠️ Late'}
                            </span>
                        ` : ''}
                    </div>
                    
                    <div class="info-row">
                        <span class="info-label">📍 Location</span>
                        <span class="info-value">${assignment.location_name || 'Location not specified'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">⏰ Expected Arrival</span>
                        <span class="info-value">${formatDateTime(assignment.expected_arrival_iso)}</span>
                    </div>
                    ${isCompleted ? `
                        <div class="info-row">
                            <span class="info-label">✅ Actual Arrival</span>
                            <span class="info-value">${formatDateTime(assignment.arrival_iso)}</span>
                        </div>
                        ${assignment.late_mins_operator > 0 ? `
                            <div class="info-row">
                                <span class="info-label">⏱️ Delay</span>
                                <span class="info-value" style="color: var(--warning-color);">${assignment.late_mins_operator} minutes</span>
                            </div>
                        ` : ''}
                        <div class="info-row">
                            <span class="info-label">💰 Earnings</span>
                            <span class="info-value"><strong>₹350</strong></span>
                        </div>
                    ` : `
                        <div class="info-row">
                            <span class="info-label">💰 Expected Earnings</span>
                            <span class="info-value"><strong>₹350</strong></span>
                        </div>
                        
                        <!-- ✅ ADD NAVIGATE BUTTON FOR UPCOMING ASSIGNMENTS -->
                        <button class="btn-primary" style="width: 100%; margin-top: 15px;" onclick="navigateToLocation('${assignment.booking_id}')">
                            🗺️ Navigate on Map
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');
}



function displayTodaySchedule(assignments) {
    const container = document.getElementById('todaySchedule');
    if (!container) return;
    
    const today = new Date().toDateString();
    const todayAssignments = assignments.filter(a => {
        try {
            const assignmentDate = new Date(a.expected_arrival_iso).toDateString();
            return assignmentDate === today;
        } catch (e) {
            return false;
        }
    });
    
    if (todayAssignments.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No assignments for today</p>';
        return;
    }
    
    container.innerHTML = todayAssignments.map(assignment => `
        <div class="schedule-item">
            <div>
                <strong>${assignment.booking_id}</strong>
                <p style="font-size: 13px; color: var(--text-secondary)">Tool: ${assignment.toolid}</p>
            </div>
            <span class="activity-time">${formatTime(assignment.expected_arrival_iso)}</span>
        </div>
    `).join('');
}

function getStatusClass(status) {
    switch(status) {
        case 'ON_TIME': return 'available';
        case 'LATE': return 'warning';
        case 'NO_SHOW': return 'danger';
        default: return 'booked';
    }
}

function filterAssignments() {
    const statusFilter = document.getElementById('assignmentStatusFilter').value;
    
    if (statusFilter === 'all') {
        displayAssignments(myAssignments);
    } else if (statusFilter === 'upcoming') {
        const upcoming = myAssignments.filter(a => !a.arrival_iso);
        displayAssignments(upcoming);
    } else {
        const filtered = myAssignments.filter(a => a.arrival_status === statusFilter);
        displayAssignments(filtered);
    }
}

// ==================== NAVIGATION MAP ====================

function navigateToLocation(bookingId) {
    const assignment = myAssignments.find(a => a.booking_id === bookingId);
    if (!assignment) {
        console.error('Assignment not found:', bookingId);
        return;
    }
    
    console.log('Navigating to:', assignment);
    showSection('navigation');
    
    setTimeout(() => {
        initializeNavigationMap(assignment);
    }, 100);
}

function initializeNavigationMap(assignment) {
    const mapContainer = document.getElementById('navigationMap');
    if (!mapContainer) {
        console.error('Map container not found');
        return;
    }
    
    console.log('Initializing map for assignment:', assignment);
    
    // Clear the map container first
    mapContainer.innerHTML = '';
    
    // Remove old map if exists
    if (navigationMap) {
        try {
            navigationMap.remove();
            navigationMap = null;
        } catch (e) {
            console.log('Old map removed');
        }
    }
    
    try {
        // Check if Leaflet is loaded
        if (typeof L === 'undefined') {
            throw new Error('Leaflet library not loaded');
        }
        
        // Initialize map centered on renter location
        const centerLat = assignment.latitude || 17.385044;
        const centerLng = assignment.longitude || 78.486671;
        
        navigationMap = L.map('navigationMap', {
            preferCanvas: true
        }).setView([centerLat, centerLng], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(navigationMap);
        
        // Operator current location (random nearby position)
        const operatorLat = centerLat + (Math.random() - 0.5) * 0.05;
        const operatorLng = centerLng + (Math.random() - 0.5) * 0.05;
        
        // Renter destination
        const renterLat = centerLat;
        const renterLng = centerLng;
        
        // Create custom icons
        const operatorIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px;">📍</div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        
        const renterIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px;">🏠</div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        
        // Add markers
        L.marker([operatorLat, operatorLng], {icon: operatorIcon})
            .bindPopup('<strong>📍 Your Location</strong><br>You are here')
            .addTo(navigationMap)
            .openPopup();
        
        L.marker([renterLat, renterLng], {icon: renterIcon})
            .bindPopup(`<strong>🏠 Renter Destination</strong><br>Booking: ${assignment.booking_id}<br>Tool: ${assignment.toolid}`)
            .addTo(navigationMap);
        
        // Draw route
        L.polyline([
            [operatorLat, operatorLng],
            [renterLat, renterLng]
        ], {
            color: '#3b82f6',
            weight: 4,
            opacity: 0.8,
            dashArray: '5, 5',
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(navigationMap);
        
        // Calculate distance
        const distance = calculateDistance(operatorLat, operatorLng, renterLat, renterLng);
        const eta = Math.ceil(distance / 20);
        
        // Update details panel
        const detailsContainer = document.getElementById('navigationDetails');
        if (detailsContainer) {
            detailsContainer.innerHTML = `
                <div style="padding: 20px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 10px; border-left: 4px solid #3b82f6;">
                    <h3 style="margin-top: 0; color: #1e40af;">🗺️ Route Details</h3>
                    <div class="tool-info">
                        <div class="info-row">
                            <span class="info-label">📍 Destination</span>
                            <span class="info-value">Renter Location</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">🚗 Distance</span>
                            <span class="info-value"><strong style="color: #3b82f6;">${distance.toFixed(2)} km</strong></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">⏱️ ETA</span>
                            <span class="info-value"><strong style="color: #10b981;">${eta} mins</strong> @ 20 km/h</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">📦 Booking</span>
                            <span class="info-value"><strong>${assignment.booking_id}</strong></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">🛠️ Tool</span>
                            <span class="info-value"><strong>${assignment.toolid}</strong></span>
                        </div>
                    </div>
                    <button class="btn-primary" style="width: 100%; margin-top: 15px;" onclick="openGoogleMaps(${renterLat}, ${renterLng})">
                        📱 Open in Google Maps
                    </button>
                </div>
            `;
        }
        
        // Fit map to show both points with padding
        setTimeout(() => {
            const bounds = L.latLngBounds([[operatorLat, operatorLng], [renterLat, renterLng]]);
            navigationMap.fitBounds(bounds.pad(0.3));
        }, 200);
        
        console.log('✓ Map initialized successfully');
        
    } catch (error) {
        console.error('Error initializing map:', error);
        showNotification('Error loading map: ' + error.message, 'error');
        
        // Show fallback UI
        const detailsContainer = document.getElementById('navigationDetails');
        if (detailsContainer) {
            const assignment_copy = assignment;
            detailsContainer.innerHTML = `
                <div style="padding: 20px; background: #fee2e2; border-radius: 10px;">
                    <h3>Map not available</h3>
                    <p style="color: #991b1b;">Booking: ${assignment_copy.booking_id}</p>
                    <p style="color: #991b1b;">Tool: ${assignment_copy.toolid}</p>
                    <button class="btn-primary" style="width: 100%; margin-top: 10px;" onclick="openGoogleMaps(${assignment_copy.latitude || 17.385044}, ${assignment_copy.longitude || 78.486671})">
                        📱 Open in Google Maps
                    </button>
                </div>
            `;
        }
    }
}

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function openGoogleMaps(lat, lng) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
    showNotification('Opening Google Maps...', 'info');
}

// ==================== EARNINGS ====================

async function loadEarnings() {
    try {
        const response = await fetch('/api/operator/earnings');
        const result = await response.json();
        
        if (result.success) {
            earningsData = result.earnings;
            console.log('✓ Loaded earnings:', earningsData);
            displayEarnings(earningsData);
        }
    } catch (error) {
        console.error('Error loading earnings:', error);
    }
}

function displayEarnings(earnings) {
    const totalElem = document.getElementById('totalEarnings');
    const monthElem = document.getElementById('monthEarnings');
    const weekElem = document.getElementById('weekEarnings');
    
    if (totalElem) totalElem.textContent = `₹${earnings.total?.toFixed(2) || '0.00'}`;
    if (monthElem) monthElem.textContent = `₹${earnings.this_month?.toFixed(2) || '0.00'}`;
    if (weekElem) weekElem.textContent = `₹${earnings.this_week?.toFixed(2) || '0.00'}`;
    
    console.log('Displaying earnings:', earnings);
    console.log('My assignments for breakdown:', myAssignments.length);
    
    const container = document.getElementById('earningsList');
    if (!container) return;
    
    // Filter assignments with completed status
    const breakdown = myAssignments
        .filter(a => a.arrival_iso && (a.arrival_status === 'ON_TIME' || a.arrival_status === 'LATE'))
        .map(a => ({
            booking_id: a.booking_id,
            date: a.arrival_iso,
            amount: a.arrival_status === 'ON_TIME' ? 350 : Math.max(0, 350 - (a.compensation_to_renter_inr * 0.3)),
            status: a.arrival_status
        }));
    
    console.log('Breakdown after filter:', breakdown.length);
    
    if (breakdown.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                <span style="font-size: 48px;">💰</span>
                <h3>No Completed Assignments Yet</h3>
                <p>Your completed assignments will appear here</p>
                <p style="margin-top: 20px; font-size: 14px;">You have <strong>${myAssignments.length}</strong> total assignments</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="border-bottom: 2px solid #e2e8f0; background: var(--bg-secondary);">
                    <th style="text-align: left; padding: 12px; font-weight: 600;">Booking ID</th>
                    <th style="text-align: left; padding: 12px; font-weight: 600;">Date</th>
                    <th style="text-align: left; padding: 12px; font-weight: 600;">Status</th>
                    <th style="text-align: right; padding: 12px; font-weight: 600;">Earnings</th>
                </tr>
            </thead>
            <tbody>
                ${breakdown.map(item => `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 12px;"><strong>${item.booking_id}</strong></td>
                        <td style="padding: 12px;">${formatDate(item.date)}</td>
                        <td style="padding: 12px;">
                            <span class="status-badge ${getStatusClass(item.status)}" style="padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                                ${item.status}
                            </span>
                        </td>
                        <td style="padding: 12px; text-align: right; color: var(--success-color);">
                            <strong>₹${item.amount.toFixed(2)}</strong>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ==================== UTILITY FUNCTIONS ====================

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
        console.error('Date format error:', e);
        return 'N/A';
    }
}

function formatTime(isoString) {
    if (!isoString) return 'N/A';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (e) {
        console.error('Time format error:', e);
        return 'N/A';
    }
}

function formatDateTime(isoString) {
    if (!isoString) return 'N/A';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('en-IN', { 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
        });
    } catch (e) {
        console.error('DateTime format error:', e);
        return 'N/A';
    }
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
        font-weight: 500;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 2700);
}

// ==================== AUTO-REFRESH ====================

setInterval(() => {
    const currentSection = document.querySelector('.content-section.active');
    if (currentSection) {
        const sectionId = currentSection.id;
        if (sectionId === 'requests') {
            loadRequests();
        } else if (sectionId === 'assignments') {
            loadAssignments();
        } else if (sectionId === 'earnings') {
            loadEarnings();
        }
    }
}, 15000);

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    console.log('✓ Operator dashboard initialized');
    loadRequests();
    loadAssignments();
    loadEarnings();
});
