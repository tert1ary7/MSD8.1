const SITES = {
    ewa: { x: 170, y: 150, type: 'datacenter', label: "EWA_TUKWILA" },
    phx: { x: 210, y: 220, type: 'datacenter', label: "PHX_PHOENIX" },
    clt: { x: 300, y: 200, type: 'datacenter', label: "CLT_CHARLOTTE" },
    sea: { x: 160, y: 140, type: 'client', label: "SEA_PUGET" },
    socal: { x: 180, y: 230, type: 'client', label: "SOCAL_HUB" },
    stl: { x: 260, y: 190, type: 'client', label: "STL_BERKELEY" },
    rid: { x: 320, y: 170, type: 'client', label: "RID_PHILLY" },
    sjc: { x: 380, y: 400, type: 'client', label: "SJC_BRAZIL" },
    blr: { x: 750, y: 250, type: 'client', label: "BLR_INDIA" }
};

const SERVICES = [
    { id: "NX_SIEMENS", state: "ok", triad: ["ewa", "phx", "clt"], down: [] },
    { id: "MATLAB_R2", state: "warn", triad: ["ewa", "phx", "clt"], down: ["ewa"] },
    { id: "ANSYS_HPC", state: "crit", triad: ["ewa", "phx", "clt"], down: ["phx", "clt"] }
];

let currentView = null;
let motionConfig = { enabled: true, maxBeads: 2, currentBeads: 0 };
let trafficInterval;
let activePaths = []; // Store healthy paths for random traffic generation

function init() {
    setupMotionToggle();
    renderSidebar();
    loadTopology(SERVICES[0].id, false);
}

function setupMotionToggle() {
    const btn = document.getElementById('motion-toggle');
    // Check OS preference
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) setMotion(false, btn);
    else setMotion(true, btn);

    btn.addEventListener('click', () => {
        setMotion(!motionConfig.enabled, btn);
    });
}

function setMotion(isOn, btn) {
    motionConfig.enabled = isOn;
    if (isOn) {
        document.body.classList.add('motion-enabled');
        btn.classList.add('active');
        btn.innerText = "MOTION: ON";
        startTrafficEngine();
    } else {
        document.body.classList.remove('motion-enabled');
        btn.classList.remove('active');
        btn.innerText = "MOTION: OFF";
        stopTrafficEngine();
    }
}

function triggerRipple(element) {
    if (!motionConfig.enabled) return;
    element.classList.remove('click-ripple');
    void element.offsetWidth; // Trigger reflow to restart animation
    element.classList.add('click-ripple');
}

function triggerDataShimmer(elementId, newText, color = null) {
    const el = document.getElementById(elementId);
    if (el.innerText !== newText) {
        el.innerText = newText;
        if (color) el.style.color = color;
        if (motionConfig.enabled) {
            el.classList.remove('refresh-shimmer');
            void el.offsetWidth;
            el.classList.add('refresh-shimmer');
        }
    }
}

function renderSidebar() {
    const grid = document.getElementById('service-grid');
    grid.innerHTML = SERVICES.map(s => `
        <div class="service-hex ${currentView === s.id ? 'active-view' : ''}" id="hex-${s.id}" onclick="handleHexClick('${s.id}')">
            <span class="lbl">${s.id.split('_')[0]}</span>
            <span class="stat ${s.state === 'ok' ? 'text-ok' : 'text-warn'}">${s.state.toUpperCase()}</span>
        </div>
    `).join('');
}

function handleHexClick(serviceId) {
    const hex = document.getElementById(`hex-${serviceId}`);
    triggerRipple(hex);
    loadTopology(serviceId, true);
}

function loadTopology(serviceId, isInteraction) {
    currentView = serviceId;
    renderSidebar();
    
    const svc = SERVICES.find(s => s.id === serviceId);
    
    triggerDataShimmer('view-title', `TOPOLOGY: ${svc.id}`);
    
    const upNodes = svc.triad.filter(n => !svc.down.includes(n));
    let quorumText = upNodes.length >= 2 ? "QUORUM MET (NOMINAL)" : "QUORUM LOST (HALTED)";
    if (upNodes.length === 2) quorumText = "QUORUM DEGRADED (1 FAULT TILL HALT)";
    
    const qColor = upNodes.length >= 2 ? (upNodes.length === 3 ? "var(--cyan)" : "var(--amber)") : "var(--red)";
    triggerDataShimmer('view-subtitle', `TRIAD STATUS: ${quorumText}`, qColor);

    drawMap(svc, upNodes, isInteraction);
}

function drawMap(svc, upNodes, isInteraction) {
    const gNodes = document.getElementById('layer-nodes');
    const gQuorum = document.getElementById('layer-quorum-links');
    const gClients = document.getElementById('layer-client-links');
    
    gNodes.innerHTML = ''; gQuorum.innerHTML = ''; gClients.innerHTML = '';
    activePaths = [];

    // 1. Quorum Links
    if (upNodes.includes("ewa") && upNodes.includes("phx")) drawLink(SITES.ewa, SITES.phx, gQuorum, 'quorum ' + (upNodes.length<3?'degraded':''));
    if (upNodes.includes("phx") && upNodes.includes("clt")) drawLink(SITES.phx, SITES.clt, gQuorum, 'quorum ' + (upNodes.length<3?'degraded':''));
    if (upNodes.includes("clt") && upNodes.includes("ewa")) drawLink(SITES.clt, SITES.ewa, gQuorum, 'quorum ' + (upNodes.length<3?'degraded':''));

    // 2. Client Routing
    Object.keys(SITES).forEach(key => {
        const site = SITES[key];
        const isFault = svc.down.includes(key);

        if (site.type === 'client' && upNodes.length > 0) {
            let closest = upNodes[0];
            let minDist = 9999;
            upNodes.forEach(t => {
                const d = Math.hypot(site.x - SITES[t].x, site.y - SITES[t].y);
                if (d < minDist) { minDist = d; closest = t; }
            });

            const pathId = `path-${key}`;
            drawLink(site, SITES[closest], gClients, 'client', pathId);
            
            // Register healthy paths for the traffic engine
            if (upNodes.length >= 2) {
                const latencySpeed = Math.max(1.5, minDist / 80).toFixed(1); // 1.5s to 5.0s traversal
                const color = minDist > 200 ? 'var(--amber)' : 'var(--cyan)';
                activePaths.push({ id: pathId, speed: latencySpeed, color: color });
            }
        }
        
        // 3. Nodes (State Change Glow applied if interaction triggered a new fault view)
        const nodeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodeG.setAttribute('class', `node ${isFault ? 'fault' : ''} ${isInteraction && isFault ? 'state-alert' : ''}`);
        
        if (site.type === 'datacenter') {
            const hex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            hex.setAttribute('points', getHexPoints(site.x, site.y, 15));
            hex.setAttribute('class', 'node-datacenter');
            nodeG.appendChild(hex);
        } else {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', site.x); circle.setAttribute('cy', site.y);
            circle.setAttribute('r', '4');
            circle.setAttribute('class', 'node-client');
            nodeG.appendChild(circle);
        }
        gNodes.appendChild(nodeG);
    });
}

// Data Flow Indication (The Travelling Bead)
function startTrafficEngine() {
    if (trafficInterval) return;
    // Batch sampling check every 2.5 seconds
    trafficInterval = setInterval(() => {
        if (!motionConfig.enabled || activePaths.length === 0) return;
        if (motionConfig.currentBeads >= motionConfig.maxBeads) return;

        // 50% chance to spawn a bead during a cycle (calm rhythm)
        if (Math.random() > 0.5) {
            spawnBead();
        }
    }, 2500); 
}

function stopTrafficEngine() {
    clearInterval(trafficInterval);
    trafficInterval = null;
    document.getElementById('layer-traffic').innerHTML = '';
    motionConfig.currentBeads = 0;
}

function spawnBead() {
    const pathData = activePaths[Math.floor(Math.random() * activePaths.length)];
    const gTraffic = document.getElementById('layer-traffic');
    
    motionConfig.currentBeads++;

    const packet = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    packet.setAttribute('r', '2.5'); 
    packet.setAttribute('fill', pathData.color);
    
    // One-time traversal using animateMotion
    const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    animate.setAttribute('dur', `${pathData.speed}s`);
    animate.setAttribute('repeatCount', '1');
    animate.setAttribute('fill', 'freeze');
    // Emulate cubic-bezier through standard keyTimes for smooth arrival
    animate.setAttribute('calcMode', 'spline');
    animate.setAttribute('keyTimes', '0;1');
    animate.setAttribute('keySplines', '0.2 0.0 0 1.0');
    
    const mPath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
    mPath.setAttribute('href', `#${pathData.id}`);
    
    animate.appendChild(mPath);
    packet.appendChild(animate);
    gTraffic.appendChild(packet);

    // Cleanup after animation completes
    setTimeout(() => {
        packet.remove();
        motionConfig.currentBeads = Math.max(0, motionConfig.currentBeads - 1);
    }, pathData.speed * 1000);
}

// Helpers
function getHexPoints(x, y, r) {
    let pts = [];
    for (let i = 0; i < 6; i++) {
        let a = (Math.PI / 180) * (60 * i - 30);
        pts.push(`${x + r * Math.cos(a)},${y + r * Math.sin(a)}`);
    }
    return pts.join(' ');
}

function drawLink(n1, n2, group, className, id = null) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const cx = (n1.x + n2.x) / 2;
    const cy = Math.min(n1.y, n2.y) - 40;
    path.setAttribute('d', `M ${n1.x} ${n1.y} Q ${cx} ${cy} ${n2.x} ${n2.y}`);
    path.setAttribute('class', `link ${className}`);
    if (id) path.setAttribute('id', id);
    group.appendChild(path);
}

window.onload = init;
