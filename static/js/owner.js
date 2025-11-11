// ==================== OWNER DASHBOARD FUNCTIONALITY ====================

let allTools = [];
let toolStatusData = [];
let geofenceData = [];
let lateReturnsData = [];
let revenueData = [];

// Chart instances
let temperatureChart = null;
let voltageChart = null;
let revenueByToolChart = null;
let revenueTrendChart = null;
let revenueOverviewChart = null;

// Map instance
let geofenceMap = null;

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
    
    // Initialize map when geofence section is shown
    if (sectionId === 'geofence') {
        setTimeout(() => {
            if (geofenceMap) {
                geofenceMap.invalidateSize();
                loadGeofenceData();
            } else {
                initializeGeofenceMap();
            }
        }, 100);
    }
}

// ==================== ADD TOOL ====================

async function handleAddTool(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const toolData = Object.fromEntries(formData);
    
    try {
        const response = await fetch('/api/owner/add-tool', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(toolData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`Tool ${result.tool_id} added successfully! 🎉`, 'success');
            event.target.reset();
            
            // Update tool count
            const currentCount = parseInt(document.getElementById('totalToolsCount').textContent) || 0;
            document.getElementById('totalToolsCount').textContent = currentCount + 1;
            
            // Refresh tools list
            setTimeout(() => {
                loadOwnerTools();
                showSection('my-tools');
            }, 1000);
        } else {
            showNotification('Failed to add tool', 'error');
        }
    } catch (error) {
        console.error('Error adding tool:', error);
        showNotification('An error occurred', 'error');
    }
}

// ==================== LOAD OWNER TOOLS ====================

async function loadOwnerTools() {
    try {
        const response = await fetch('/api/owner/tools');
        const result = await response.json();
        
        if (result.success) {
            allTools = result.tools;
            console.log('Loaded owner tools:', allTools.length);
            displayOwnerTools(allTools);
        }
    } catch (error) {
        console.error('Error loading tools:', error);
    }
}

function displayOwnerTools(tools) {
    const container = document.getElementById('toolsList');
    
    if (!tools || tools.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span style="font-size: 64px;">🔧</span>
                <h3>No Tools Added Yet</h3>
                <p>Start by adding your first tool to the inventory</p>
                <button class="btn-primary" onclick="showSection('add-tool')">Add Tool</button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = tools.map(tool => `
        <div class="tool-card">
            <div class="tool-header">
                <div class="tool-title">
                    <h3>${tool.tool_type || 'Tool'}</h3>
                    <span class="tool-id">${tool.toolid}</span>
                </div>
                <span class="status-badge ${getToolStatus(tool)}">${getToolStatus(tool).toUpperCase()}</span>
            </div>
            
            <div class="tool-info">
                <div class="info-row">
                    <span class="info-label">🌡️ Temperature</span>
                    <span class="${getTempStatus(tool.temperature_c)}">${tool.temperature_c || 25}°C</span>
                </div>
                <div class="info-row">
                    <span class="info-label">⚡ Voltage</span>
                    <span class="${getVoltageStatus(tool.voltage_v)}">${tool.voltage_v || 230}V</span>
                </div>
                <div class="info-row">
                    <span class="info-label">📳 Vibration</span>
                    <span class="sensor-value normal">${tool.vibration_hz || 40} Hz</span>
                </div>
                <div class="info-row">
                    <span class="info-label">📡 Sensor</span>
                    <span class="${tool.sensor_active === false ? 'sensor-value danger' : 'sensor-value normal'}">${tool.sensor_active === false ? 'Inactive' : 'Active'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">🕒 Last Updated</span>
                    <span class="info-value">${formatTime(tool.ts_iso || new Date().toISOString())}</span>
                </div>
            </div>
            
            <div class="tool-actions">
                <button class="btn-secondary" onclick="viewToolDetails('${tool.toolid}')">View Details</button>
                <button class="btn-primary" onclick="monitorTool('${tool.toolid}')">Monitor</button>
            </div>
        </div>
    `).join('');
}

function getToolStatus(tool) {
    if (tool.sensor_active === false) return 'maintenance';
    const temp = tool.temperature_c || 25;
    const voltage = tool.voltage_v || 230;
    if (temp > 80 || voltage < 200) return 'warning';
    return 'active';
}

function getTempStatus(temp) {
    if (!temp) temp = 25;
    if (temp > 85) return 'sensor-value danger';
    if (temp > 75) return 'sensor-value warning';
    return 'sensor-value normal';
}

function getVoltageStatus(voltage) {
    if (!voltage) voltage = 230;
    if (voltage < 200) return 'sensor-value danger';
    if (voltage < 220) return 'sensor-value warning';
    return 'sensor-value normal';
}

// ==================== TOOL STATUS MONITORING WITH CHARTS ====================

async function loadToolStatus() {
    try {
        const response = await fetch('/api/owner/tools');
        const result = await response.json();
        
        if (result.success) {
            toolStatusData = result.tools;
            console.log('Loaded tool status:', toolStatusData.length);
            displayToolStatus(toolStatusData);
            updateTemperatureChart(toolStatusData);
            updateVoltageChart(toolStatusData);
        }
    } catch (error) {
        console.error('Error loading tool status:', error);
    }
}

function displayToolStatus(tools) {
    const container = document.getElementById('toolStatusList');
    
    if (!tools || tools.length === 0) {
        container.innerHTML = '<p>No tools to monitor</p>';
        return;
    }
    
    container.innerHTML = tools.map(tool => `
        <div class="status-card">
            <div class="status-header">
                <div>
                    <h3>${tool.toolid}</h3>
                    <p>${tool.tool_type || 'Tool'}</p>
                </div>
                <span class="status-badge ${tool.sensor_active === false ? 'maintenance' : 'active'}">
                    ${tool.sensor_active === false ? 'Inactive' : 'Active'}
                </span>
            </div>
            
            <div class="sensor-grid">
                <div class="sensor-item">
                    <div class="sensor-label">🌡️ Temperature</div>
                    <div class="${getTempStatus(tool.temperature_c || 25)}">${tool.temperature_c || 25}°C</div>
                    ${(tool.temperature_c || 25) > 85 ? '<small style="color: red;">⚠️ Above Threshold!</small>' : ''}
                </div>
                
                <div class="sensor-item">
                    <div class="sensor-label">⚡ Voltage</div>
                    <div class="${getVoltageStatus(tool.voltage_v || 230)}">${tool.voltage_v || 230}V</div>
                    ${(tool.voltage_v || 230) < 200 ? '<small style="color: red;">⚠️ Low Voltage!</small>' : ''}
                </div>
                
                <div class="sensor-item">
                    <div class="sensor-label">📡 Sensor Status</div>
                    <div class="${tool.sensor_active === false ? 'sensor-value danger' : 'sensor-value normal'}">
                        ${tool.sensor_active === false ? 'Inactive' : 'Active'}
                    </div>
                </div>
                
                <div class="sensor-item">
                    <div class="sensor-label">🕒 Last Update</div>
                    <div class="sensor-value">${formatTime(tool.ts_iso || new Date().toISOString())}</div>
                </div>
            </div>
            
            ${shouldShowAlert(tool) ? `
                <div class="alert-box" style="margin-top: 15px; padding: 12px; background: #fee2e2; border-radius: 8px; color: #991b1b;">
                    <strong>⚠️ Alert:</strong> ${getAlertMessage(tool)}
                </div>
            ` : ''}
        </div>
    `).join('');
}

function shouldShowAlert(tool) {
    const temp = tool.temperature_c || 25;
    const voltage = tool.voltage_v || 230;
    return temp > 85 || voltage < 200 || tool.sensor_active === false;
}

function getAlertMessage(tool) {
    const alerts = [];
    const temp = tool.temperature_c || 25;
    const voltage = tool.voltage_v || 230;
    if (temp > 85) alerts.push('Temperature exceeds threshold');
    if (voltage < 200) alerts.push('Voltage drop detected');
    if (tool.sensor_active === false) alerts.push('Sensor is inactive');
    return alerts.join(', ');
}

// ==================== TEMPERATURE CHART ====================

function updateTemperatureChart(tools) {
    const ctx = document.getElementById('temperatureChart');
    if (!ctx || tools.length === 0) return;
    
    const labels = tools.map(t => t.toolid);
    const data = tools.map(t => t.temperature_c || 25);
    const colors = data.map(temp => {
        if (temp > 85) return '#ef4444';
        if (temp > 75) return '#f59e0b';
        return '#10b981';
    });
    
    if (temperatureChart) {
        temperatureChart.destroy();
    }
    
    temperatureChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Temperature (°C)',
                data: data,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.parsed.y}°C`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Temperature (°C)' }
                }
            }
        }
    });
}

// ==================== VOLTAGE CHART ====================

function updateVoltageChart(tools) {
    const ctx = document.getElementById('voltageChart');
    if (!ctx || tools.length === 0) return;
    
    const labels = tools.map(t => t.toolid);
    const data = tools.map(t => t.voltage_v || 230);
    const colors = data.map(voltage => {
        if (voltage < 200) return '#ef4444';
        if (voltage < 220) return '#f59e0b';
        return '#10b981';
    });
    
    if (voltageChart) {
        voltageChart.destroy();
    }
    
    voltageChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Voltage (V)',
                data: data,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true,
                pointBackgroundColor: colors,
                pointBorderColor: colors,
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.parsed.y}V`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    min: 180,
                    max: 250,
                    title: { display: true, text: 'Voltage (V)' }
                }
            }
        }
    });
}

// ==================== GEOFENCE MAP (FIXED WITH VISIBLE MARKERS) ====================

function initializeGeofenceMap() {
    const mapContainer = document.getElementById('geofenceMap');
    if (!mapContainer) return;
    
    geofenceMap = L.map('geofenceMap').setView([17.385044, 78.486671], 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(geofenceMap);
    
    loadGeofenceData();
}

function updateGeofenceMap() {
    if (!geofenceMap) return;
    
    // Clear existing layers except base map
    geofenceMap.eachLayer((layer) => {
        if (layer instanceof L.Circle || layer instanceof L.CircleMarker || layer instanceof L.Marker) {
            geofenceMap.removeLayer(layer);
        }
    });
    
    if (!geofenceData || geofenceData.length === 0) return;
    
    // Add geofence circles and tool markers
    geofenceData.forEach(item => {
        if (item.latitude && item.longitude && item.geo_center_lat && item.geo_center_lng) {
            // Add geofence circle (blue)
            L.circle([item.geo_center_lat, item.geo_center_lng], {
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                radius: item.geo_radius_m || 5000,
                weight: 2
            }).addTo(geofenceMap);
            
            // Add tool marker (green if inside, red if outside) - FIXED
            const markerColor = item.within_fence ? '#10b981' : '#ef4444';
            const markerIcon = L.divIcon({
                className: 'custom-marker',
                html: `<div style="background-color: ${markerColor}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4);"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            
            const marker = L.marker([item.latitude, item.longitude], {
                icon: markerIcon
            }).addTo(geofenceMap);
            
            // Add popup with tool info
            marker.bindPopup(`
                <div style="font-family: system-ui; padding: 5px;">
                    <strong style="font-size: 14px;">${item.toolid}</strong><br>
                    <span style="color: ${markerColor}; font-weight: bold;">
                        ${item.within_fence ? '✅ Inside Geofence' : '❌ Outside Geofence'}
                    </span><br>
                    <small>Distance: ${item.distance_from_center_km} km</small><br>
                    <small>Updated: ${formatDateTime(item.ts_iso)}</small>
                </div>
            `);
        }
    });
    
    // Auto-fit map to show all markers
    if (geofenceData.length > 0) {
        const bounds = L.latLngBounds(geofenceData.map(d => [d.latitude, d.longitude]));
        geofenceMap.fitBounds(bounds.pad(0.2));
    }
}

// ==================== GEOFENCE DATA ====================

async function loadGeofenceData() {
    try {
        const response = await fetch('/api/owner/geofence');
        const result = await response.json();
        
        if (result.success) {
            geofenceData = result.data;
            console.log('Loaded geofence data:', geofenceData.length);
            displayGeofenceData(geofenceData);
            updateGeofenceSummary(geofenceData);
            if (geofenceMap) {
                updateGeofenceMap();
            }
        }
    } catch (error) {
        console.error('Error loading geofence data:', error);
    }
}

function displayGeofenceData(data) {
    const container = document.getElementById('geofenceList');
    
    if (!data || data.length === 0) {
        container.innerHTML = '<p>No geofence events recorded</p>';
        return;
    }
    
    const breaches = data.filter(d => d.breach_type === 'exit');
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Tool ID</th>
                    <th>Breach Type</th>
                    <th>Distance (km)</th>
                    <th>Location</th>
                    <th>Timestamp</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${breaches.map(item => `
                    <tr>
                        <td><strong>${item.toolid}</strong></td>
                        <td><span class="status-badge ${item.breach_type === 'exit' ? 'danger' : 'available'}">${item.breach_type.toUpperCase()}</span></td>
                        <td>${item.distance_from_center_km ? item.distance_from_center_km.toFixed(2) : 'N/A'} km</td>
                        <td>${item.latitude ? item.latitude.toFixed(4) : 'N/A'}, ${item.longitude ? item.longitude.toFixed(4) : 'N/A'}</td>
                        <td>${formatDateTime(item.ts_iso)}</td>
                        <td>${item.within_fence ? '✅ Inside' : '❌ Outside'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function updateGeofenceSummary(data) {
    const totalBreaches = data.filter(d => d.breach_type === 'exit').length;
    const exitBreaches = data.filter(d => d.breach_type === 'exit' && !d.within_fence).length;
    const entryEvents = data.filter(d => d.breach_type === 'entry').length;
    
    const elem1 = document.getElementById('totalBreaches');
    const elem2 = document.getElementById('exitBreaches');
    const elem3 = document.getElementById('entryBreaches');
    
    if (elem1) elem1.textContent = totalBreaches;
    if (elem2) elem2.textContent = exitBreaches;
    if (elem3) elem3.textContent = entryEvents;
}

// ==================== LATE RETURNS ====================

async function loadLateReturns() {
    try {
        const response = await fetch('/api/owner/late-returns');
        const result = await response.json();
        
        if (result.success) {
            lateReturnsData = result.data;
            displayLateReturns(lateReturnsData);
            updateLateReturnsSummary(lateReturnsData);
        }
    } catch (error) {
        console.error('Error loading late returns:', error);
    }
}

function displayLateReturns(data) {
    const container = document.getElementById('lateReturnsList');
    
    if (!data || data.length === 0) {
        container.innerHTML = '<p>No late returns recorded</p>';
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Booking ID</th>
                    <th>Tool ID</th>
                    <th>Renter ID</th>
                    <th>Expected Return</th>
                    <th>Actual Return</th>
                    <th>Delay (hours)</th>
                    <th>Penalty (₹)</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(item => `
                    <tr>
                        <td><strong>${item.booking_id}</strong></td>
                        <td>${item.toolid}</td>
                        <td>${item.renter_id}</td>
                        <td>${formatDateTime(item.expected_return_iso)}</td>
                        <td>${formatDateTime(item.actual_return_iso)}</td>
                        <td><span style="color: ${item.delay_hours > 24 ? 'red' : 'orange'}">${item.delay_hours}h</span></td>
                        <td><strong>₹${item.penalty_inr}</strong></td>
                        <td><span class="status-badge ${item.penalty_paid ? 'available' : 'danger'}">${item.penalty_paid ? 'Paid' : 'Pending'}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function updateLateReturnsSummary(data) {
    const totalLateReturns = data.length;
    const totalPenalties = data.reduce((sum, item) => sum + (item.penalty_inr || 0), 0);
    const avgDelay = data.length > 0 ? data.reduce((sum, item) => sum + (item.delay_hours || 0), 0) / data.length : 0;
    
    const elem1 = document.getElementById('totalLateReturns');
    const elem2 = document.getElementById('totalPenalties');
    const elem3 = document.getElementById('avgDelayHours');
    
    if (elem1) elem1.textContent = totalLateReturns;
    if (elem2) elem2.textContent = `₹${totalPenalties.toFixed(2)}`;
    if (elem3) elem3.textContent = `${avgDelay.toFixed(1)}h`;
}

// ==================== REVENUE WITH CHARTS ====================

async function loadRevenueData() {
    try {
        const response = await fetch('/api/owner/revenue');
        const result = await response.json();
        
        if (result.success) {
            revenueData = result.data;
            console.log('Loaded revenue data:', revenueData.length);
            displayRevenueData(revenueData);
            updateRevenueSummary(revenueData);
            updateRevenueCharts(revenueData);
            updateRevenueOverviewChart(revenueData);
        }
    } catch (error) {
        console.error('Error loading revenue data:', error);
    }
}

function displayRevenueData(data) {
    const container = document.getElementById('revenueList');
    
    if (!data || data.length === 0) {
        container.innerHTML = '<p>No revenue data available</p>';
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Tool ID</th>
                    <th>Date</th>
                    <th>Rentals Count</th>
                    <th>Total Hours</th>
                    <th>Revenue (₹)</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(item => `
                    <tr>
                        <td><strong>${item.toolid}</strong></td>
                        <td>${formatDate(item.date_iso)}</td>
                        <td>${item.rentals_count}</td>
                        <td>${item.total_rental_hours ? item.total_rental_hours.toFixed(1) : '0'}h</td>
                        <td><strong style="color: var(--success-color)">₹${item.revenue_inr ? item.revenue_inr.toFixed(2) : '0'}</strong></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function updateRevenueSummary(data) {
    const totalRevenue = data.reduce((sum, item) => sum + (item.revenue_inr || 0), 0);
    const totalRentals = data.reduce((sum, item) => sum + (item.rentals_count || 0), 0);
    const uniqueTools = new Set(data.map(d => d.toolid)).size;
    const avgRevenuePerTool = uniqueTools > 0 ? totalRevenue / uniqueTools : 0;
    
    const elem1 = document.getElementById('totalRevenue');
    const elem2 = document.getElementById('totalRentals');
    const elem3 = document.getElementById('avgRevenuePerTool');
    const elem4 = document.getElementById('totalRevenueCount');
    
    if (elem1) elem1.textContent = `₹${totalRevenue.toFixed(2)}`;
    if (elem2) elem2.textContent = totalRentals;
    if (elem3) elem3.textContent = `₹${avgRevenuePerTool.toFixed(2)}`;
    if (elem4) elem4.textContent = `₹${totalRevenue.toFixed(2)}`;
}

function updateRevenueCharts(data) {
    if (data.length === 0) return;
    updateRevenueByToolChart(data);
    updateRevenueTrendChart(data);
}

function updateRevenueByToolChart(data) {
    const ctx = document.getElementById('revenueByToolChart');
    if (!ctx) return;
    
    const revenueByTool = {};
    data.forEach(item => {
        if (!revenueByTool[item.toolid]) {
            revenueByTool[item.toolid] = 0;
        }
        revenueByTool[item.toolid] += item.revenue_inr || 0;
    });
    
    const labels = Object.keys(revenueByTool);
    const values = Object.values(revenueByTool);
    
    if (revenueByToolChart) {
        revenueByToolChart.destroy();
    }
    
    revenueByToolChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue (₹)',
                data: values,
                backgroundColor: '#10b981',
                borderColor: '#059669',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `₹${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Revenue (₹)' }
                }
            }
        }
    });
}

function updateRevenueTrendChart(data) {
    const ctx = document.getElementById('revenueTrendChart');
    if (!ctx) return;
    
    const sortedData = [...data].sort((a, b) => new Date(a.date_iso) - new Date(b.date_iso));
    
    const revenueByDate = {};
    sortedData.forEach(item => {
        const date = formatDate(item.date_iso);
        if (!revenueByDate[date]) {
            revenueByDate[date] = 0;
        }
        revenueByDate[date] += item.revenue_inr || 0;
    });
    
    const labels = Object.keys(revenueByDate);
    const values = Object.values(revenueByDate);
    
    if (revenueTrendChart) {
        revenueTrendChart.destroy();
    }
    
    revenueTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Revenue',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `₹${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Revenue (₹)' }
                }
            }
        }
    });
}

function updateRevenueOverviewChart(data) {
    const ctx = document.getElementById('revenueOverviewChart');
    if (!ctx || data.length === 0) return;
    
    const last7Days = data.slice(-7);
    const labels = last7Days.map(d => formatDate(d.date_iso));
    const values = last7Days.map(d => d.revenue_inr || 0);
    
    if (revenueOverviewChart) {
        revenueOverviewChart.destroy();
    }
    
    revenueOverviewChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue',
                data: values,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

// ==================== UTILITY FUNCTIONS ====================

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-IN');
}

function formatTime(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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

function viewToolDetails(toolId) {
    showSection('tool-status');
}

function monitorTool(toolId) {
    showSection('tool-status');
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
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
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

// ==================== AUTO-REFRESH ====================

setInterval(() => {
    const currentSection = document.querySelector('.content-section.active');
    if (currentSection) {
        const sectionId = currentSection.id;
        if (sectionId === 'tool-status') {
            loadToolStatus();
        } else if (sectionId === 'geofence') {
            loadGeofenceData();
        } else if (sectionId === 'revenue') {
            loadRevenueData();
        } else if (sectionId === 'my-tools') {
            loadOwnerTools();
        } else if (sectionId === 'late-returns') {
            loadLateReturns();
        }
    }
}, 10000);
