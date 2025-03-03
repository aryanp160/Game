// Page navigation
const pages = {
    landing: document.getElementById('landing-page'),
    host: document.getElementById('host-page'),
    join: document.getElementById('join-page'),
    countdown: document.getElementById('countdown-page')
};

function showPage(pageId) {
    Object.values(pages).forEach(page => page.classList.remove('active'));
    if (pageId) pages[pageId].classList.add('active');
}

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game-container').appendChild(renderer.domElement);

// Lighting and floor
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(0, 10, 10);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const floorGeometry = new THREE.PlaneGeometry(50, 50);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Walls for boundaries
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
const wallGeometry = new THREE.BoxGeometry(50, 10, 1);
const wall1 = new THREE.Mesh(wallGeometry, wallMaterial);
wall1.position.set(0, 5, -25);
scene.add(wall1);
const wall2 = new THREE.Mesh(wallGeometry, wallMaterial);
wall2.position.set(0, 5, 25);
scene.add(wall2);

// Player class
class Player {
    constructor(color, x, z, isLocal) {
        this.geometry = new THREE.BoxGeometry(1, 1, 1);
        this.material = new THREE.MeshStandardMaterial({ color });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.position.set(x, 0.5, z);
        this.health = 100;
        this.isLocal = isLocal;
        this.speed = 0.1;
        this.shootCooldown = 0;
        this.velocity = 0;
        this.gravity = -0.02;
        this.reloadTime = 100;
        this.ammo = 5;
        scene.add(this.mesh);
    }

    move(keys) {
        if (!this.isLocal) return;
        const oldPos = this.mesh.position.clone();
        if (keys['w'] && this.mesh.position.z > -24) this.mesh.position.z -= this.speed;
        if (keys['s'] && this.mesh.position.z < 24) this.mesh.position.z += this.speed;
        if (keys['a'] && this.mesh.position.x > -24) this.mesh.position.x -= this.speed;
        if (keys['d'] && this.mesh.position.x < 24) this.mesh.position.x += this.speed;
        if (keys[' '] && this.shootCooldown <= 0 && this.ammo > 0) {
            this.shoot();
            this.shootCooldown = 20;
            this.ammo--;
        }
        if (keys['r']) this.reload();
        if (keys[' '] && this.mesh.position.y <= 0.5) this.velocity = 0.2; // Jump
        this.velocity += this.gravity;
        this.mesh.position.y = Math.max(0.5, this.mesh.position.y + this.velocity);
        if (this.shootCooldown > 0) this.shootCooldown--;
        
        if (!oldPos.equals(this.mesh.position) && dataChannel?.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'move', x: this.mesh.position.x, z: this.mesh.position.z }));
        }
    }

    shoot() {
        const direction = new THREE.Vector3(1, 0, 0).normalize();
        const proj = new Projectile(this.mesh.position.x, 0.5, this.mesh.position.z, direction, this);
        projectiles.push(proj);
        if (dataChannel?.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'shoot', x: proj.mesh.position.x, z: proj.mesh.position.z }));
        }
    }

    reload() {
        setTimeout(() => { this.ammo = 5; }, this.reloadTime);
    }
}

// Projectile class with out-of-bounds removal
class Projectile {
    constructor(x, y, z, direction, owner) {
        this.geometry = new THREE.SphereGeometry(0.2, 8, 8);
        this.material = new THREE.MeshStandardMaterial({ color: owner.material.color });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.position.set(x, y, z);
        this.direction = direction;
        this.speed = 0.2;
        this.owner = owner;
        scene.add(this.mesh);
    }

    update() {
        this.mesh.position.add(this.direction.clone().multiplyScalar(this.speed));
        const opponent = this.owner === localPlayer ? remotePlayer : localPlayer;
        if (this.mesh.position.distanceTo(opponent.mesh.position) < 1) {
            opponent.health -= 10;
            scene.remove(this.mesh);
            return true;
        }
        if (this.mesh.position.x > 25 || this.mesh.position.x < -25 || this.mesh.position.z > 25 || this.mesh.position.z < -25) {
            scene.remove(this.mesh);
            return true;
        }
        return false;
    }
}

// Game state
let localPlayer, remotePlayer, dataChannel;
const projectiles = [];
const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

// WebRTC setup
function setupPeerConnection(isHost) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    if (isHost) {
        dataChannel = pc.createDataChannel('game');
        setupDataChannel(dataChannel);
    } else {
        pc.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
        };
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('New ICE candidate:', event.candidate);
            // Normally, send this candidate to the signaling server
        }
    };

    return pc;
}

function setupDataChannel(channel) {
    channel.onopen = () => {
        showPage('countdown');
        startCountdown();
    };
    channel.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'move') {
            remotePlayer.updateRemote(data.x, data.z);
        } else if (data.type === 'shoot') {
            const direction = new THREE.Vector3(-1, 0, 0).normalize(); // Opposite for remote
            projectiles.push(new Projectile(data.x, 0.5, data.z, direction, remotePlayer));
        }
    };
}

// Generate a random 6-character join code
function generateJoinCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Host and Join logic
document.getElementById('host-game').onclick = async () => {
    showPage('host');
    const pc = setupPeerConnection(true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    setTimeout(() => { // 🔥 Fix: Ensure localDescription is set before storing
        const joinCode = generateJoinCode();
        localStorage.setItem(joinCode, JSON.stringify(pc.localDescription));
        document.getElementById('host-code').value = joinCode;
    }, 1000); // 🔥 Delay storing the offer to avoid an incomplete value

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected') {
            document.getElementById('host-waiting').innerHTML = 'Opponent connected!';
        }
    };

    window.pc = pc; // Store for debugging
};


document.getElementById('join-game').onclick = () => showPage('join');

document.getElementById('connect-btn').onclick = async () => {
    const joinCode = document.getElementById('join-code').value.trim(); // 🔥 Fix: Trim spaces
    const offerJson = localStorage.getItem(joinCode); // 🔥 Fix: Read stored offer

    if (!offerJson) {
        alert('Invalid game code!'); // 🔥 Fix: More informative error message
        return;
    }

    try {
        const offer = JSON.parse(offerJson);
        const pc = setupPeerConnection(false);
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        localStorage.setItem(joinCode + '-answer', JSON.stringify(pc.localDescription)); // 🔥 Fix: Store answer properly

        document.getElementById('join-code').value = 'Answer stored, waiting for connection...';

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'connected') {
                console.log('Connected to host!');
            }
        };

        window.pc = pc; // Store for debugging
    } catch (error) {
        alert("Error processing the game code. Try again.");
        console.error("Join error:", error);
    }
};





// Countdown
function startCountdown() {
    let timeLeft = 5;
    const countdownEl = document.getElementById('countdown');
    if (!countdownEl) return console.error("Countdown element not found!");

    const timer = setInterval(() => {
        timeLeft--;
        countdownEl.textContent = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(timer);
            showPage(null); // Hide all pages properly

            // Initialize players
            localPlayer = new Player(0xff0000, -5, 0, true);
            remotePlayer = new Player(0x0000ff, 5, 0, false);

            // Start animation loop
            animate();
        }
    }, 1000);
}

// Health display
const healthDisplay = document.getElementById('health-display');

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    if (localPlayer) localPlayer.move(keys);

    // Update and remove projectiles safely
    for (let i = projectiles.length - 1; i >= 0; i--) {
        if (projectiles[i].update()) {
            projectiles.splice(i, 1);
        }
    }

    // Update health display
    if (localPlayer && remotePlayer && healthDisplay) {
        healthDisplay.innerHTML = `You: ${localPlayer.health} | Opponent: ${remotePlayer.health}`;

        if (localPlayer.health <= 0) {
            healthDisplay.innerHTML = "Opponent Wins!";
            return;
        } else if (remotePlayer.health <= 0) {
            healthDisplay.innerHTML = "You Win!";
            return;
        }
    }

    renderer.render(scene, camera);
}
