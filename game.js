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
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game-container').appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(0, 10, 10);
scene.add(light);
const floorGeometry = new THREE.PlaneGeometry(50, 50);
const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x555555 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Player class
class Player {
 constructor(color, x, z, isLocal) {
 this.geometry = new THREE.BoxGeometry(1, 1, 1);
 this.material = new THREE.MeshBasicMaterial({ color });
 this.mesh = new THREE.Mesh(this.geometry, this.material);
 this.mesh.position.set(x, 0.5, z);
 this.health = 100;
 this.isLocal = isLocal;
 this.speed = 0.1;
 this.shootCooldown = 0;
 scene.add(this.mesh);
 }

 move(keys) {
 if (!this.isLocal) return;
 const oldPos = this.mesh.position.clone();
 if (keys['w']) this.mesh.position.z -= this.speed;
 if (keys['s']) this.mesh.position.z += this.speed;
 if (keys['a']) this.mesh.position.x -= this.speed;
 if (keys['d']) this.mesh.position.x += this.speed;
 if (keys[' '] && this.shootCooldown <= 0) {
 this.shoot();
 this.shootCooldown = 20;
 }
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

 updateRemote(x, z) {
 if (!this.isLocal) this.mesh.position.set(x, 0.5, z);
 }
}

class Projectile {
 constructor(x, y, z, direction, owner) {
 this.geometry = new THREE.SphereGeometry(0.2, 8, 8);
 this.material = new THREE.MeshBasicMaterial({ color: owner.material.color });
 this.mesh = new THREE.Mesh(this.geometry, this.material);
 this.mesh.position.set(x, y, z);
 this.direction = direction;
 this.speed = 0.2;
 this.owner = owner;
 scene.add(this.mesh);
 }

 update() {
 this.mesh.position.add(this .direction.clone().multiplyScalar(this.speed));
 const opponent = this.owner === localPlayer ? remotePlayer : localPlayer;
 if (this.mesh.position.distanceTo(opponent.mesh.position) < 1) {
 opponent.health -= 10;
 scene.remove(this.mesh);
 return true;
 }
 return this.mesh.position.x > 25 || this.mesh.position.x < -25;
 }
}

// Game state
let localPlayer, remotePlayer, dataChannel, pc;
const projectiles = [];
const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

// WebRTC setup
function setupPeerConnection(isHost) {
 pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

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
 if (!event.candidate) {
 const code = btoa(JSON.stringify(pc.localDescription));
 if (isHost) {
 document.getElementById('host-code').value = code;
 }
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
 const direction = new THREE.Vector3(-1, 0, 0).normalize();
 projectiles.push(new Projectile(data.x, 0.5, data.z, direction, remotePlayer));
 }
 };
}

// Host and Join logic
document.getElementById('host-game').onclick = async () => {
 showPage('host');
 pc = setupPeerConnection(true);
 const offer = await pc.createOffer();
 await pc.setLocalDescription(offer);
};

document.getElementById('join-game').onclick = () => showPage('join');

document.getElementById('connect-btn').onclick = async () => {
 const code = document.getElementById('join-code').value.trim();
 if (!code) {
 alert('Please enter a valid game code!');
 return;
 }
 try {
 pc = setupPeerConnection(false);
 const offer = JSON.parse(atob(code));
 await pc.setRemoteDescription(offer);
 const answer = await pc.createAnswer();
 await pc.setLocalDescription(answer);

 // Prompt host to paste this answer manually
 const answerCode = btoa(JSON.stringify(pc.localDescription));
 prompt('Send this answer code to the host:', answerCode);
 } catch (error) {
 console.error('Error connecting:', error);
 alert('Invalid game code or connection error. Check the console for details.');
 }

 // Host must manually set the answer
 if (pc && pc.connectionState !== 'connected') {
 const answerCode = prompt('Host: Paste the answer code from the joiner:');
 if (answerCode) {
 const answer = JSON.parse(atob(answerCode));
 await pc.setRemoteDescription(answer);
 }
 }
};

// Countdown
function startCountdown() {
 let timeLeft = 5;
 const countdownEl = document.getElementById('countdown');
 const timer = setInterval(() => {
 timeLeft--;
 countdownEl.textContent = timeLeft;
 if (timeLeft <= 0) {
 clearInterval(timer);
 showPage(null);
 localPlayer = new Player(0xff0000, -5, 0, true);
 remotePlayer = new Player(0x0000ff, 5, 0, false);
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
 projectiles.forEach((proj, i) => {
 if (proj.update()) projectiles.splice(i, 1);
 });
 if (localPlayer && remotePlayer) {
 healthDisplay.innerHTML = `You: ${localPlayer.health} | Opponent: ${remotePlayer.health}`;
 if (localPlayer.health <= 0) healthDisplay.innerHTML = "Opponent Wins!";
 else if (remotePlayer.health <= 0) healthDisplay.innerHTML = "You Win!";
 }
 renderer.render(scene, camera);
}
