import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// @ts-ignore
import * as THREE from 'three';
// @ts-ignore
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// @ts-ignore
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
// @ts-ignore
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
// @ts-ignore
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
// @ts-ignore
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const CONFIG = {
    colors: {
        gold: 0xd4af37,
        green: 0x0f4214,
        red: 0x8a0303,
        cream: 0xfceea7,
        blueLight: 0x1e3a8a,
        white: 0xffffff
    },
    particleCount: 1200,
    snowCount: 1000,
    modes: {
        TREE: 'TREE',
        SCATTER: 'SCATTER',
        FOCUS: 'FOCUS',
        HEART: 'HEART'
    },
    treeHeight: 35,
    treeBaseRadius: 14,
    spiralTurns: 4.5
};

const STATE = {
    mode: CONFIG.modes.TREE,
    handDetected: false,
    rotationTarget: { x: 0, y: 0 },
    focusTargetIndex: -1 as number,
    gestureLabel: "Detecting..."
};

// --- Helpers ---
function createCandyCaneTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 20;
    ctx.beginPath();
    for(let i = -128; i < 256; i+=40) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 128, 128);
    }
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function createDefaultPhotoTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eee8d5'; // Dimmer paper
    ctx.fillRect(0,0,512,512);
    ctx.fillStyle = '#bfa145'; // Dimmer Gold
    ctx.fillRect(40, 40, 432, 380);
    ctx.fillStyle = '#dddddd';
    ctx.font = 'bold 60px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JOYEUX', 256, 200);
    ctx.fillText('NOEL', 256, 270);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// --- Particle Class ---
class Particle {
    mesh: any;
    type: string;
    baseScale: any;
    position: any;
    targetPosition: any;
    velocity: any;
    rotationSpeed: any;
    scatterPos: any;
    treePos: any;
    heartPos: any;

    constructor(mesh: any, type: string) {
        this.mesh = mesh;
        this.type = type;
        this.baseScale = mesh.scale.clone();
        this.position = new THREE.Vector3();
        this.targetPosition = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.rotationSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02
        );
        
        const r = 10 + Math.random() * 20;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.scatterPos = new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );

        this.treePos = new THREE.Vector3();

        const u = Math.random() * Math.PI * 2;
        const v = Math.random() * Math.PI;
        const x = 16 * Math.pow(Math.sin(u), 3) * Math.pow(Math.sin(v), 2);
        const y = (13 * Math.cos(u) - 5 * Math.cos(2*u) - 2 * Math.cos(3*u) - Math.cos(4*u)) * Math.pow(Math.sin(v), 2);
        const z = 6 * Math.cos(v); 
        this.heartPos = new THREE.Vector3(x, y, z).multiplyScalar(0.7);
        this.heartPos.y += 5; 
    }

    update(dt: number, mainGroupRotation: any) {
        this.mesh.position.lerp(this.targetPosition, 0.08);

        let targetScale = this.baseScale;
        if (STATE.mode === CONFIG.modes.FOCUS && this.type === 'PHOTO') {
            if (STATE.focusTargetIndex === this.mesh.userData.id) {
                    targetScale = new THREE.Vector3(4.5, 4.5, 4.5);
            }
        }
        this.mesh.scale.lerp(targetScale, 0.1);

        if (STATE.mode === CONFIG.modes.SCATTER) {
            this.mesh.rotation.x += this.rotationSpeed.x;
            this.mesh.rotation.y += this.rotationSpeed.y;
            this.mesh.rotation.z += this.rotationSpeed.z;
        } else if (STATE.mode === CONFIG.modes.FOCUS && STATE.focusTargetIndex === this.mesh.userData.id) {
             // Handled in main loop for inverse rotation
        } else {
            if (this.type !== 'PHOTO') {
                this.mesh.rotation.y += 0.005;
            }
        }
    }
}

// --- Main App Class ---
class ChristmasApp {
    container: HTMLElement;
    particles: Particle[];
    photoTextures: any[];
    pmremGenerator: any;
    clock: any;
    mainGroup: any;
    scene: any;
    camera: any;
    renderer: any;
    composer: any;
    snowSystem: any;
    snowVelocities: any[];
    starMesh: any; 
    ribbonCurve: any;
    handLandmarker: any;
    webcamRunning: boolean;
    photoCount: number;
    availablePhotoIds: number[]; // For Shuffle Logic

    constructor() {
        this.container = document.body;
        this.particles = [];
        this.photoTextures = [createDefaultPhotoTexture()];
        this.clock = new THREE.Clock();
        this.mainGroup = new THREE.Group();
        this.webcamRunning = false;
        this.starMesh = null;
        this.photoCount = 0;
        this.snowVelocities = [];
        this.availablePhotoIds = [];
    }

    async init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050505);

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 90);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 2.0;
        this.container.appendChild(this.renderer.domElement);

        // Environment
        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        const innerLight = new THREE.PointLight(0xffaa00, 3, 40);
        this.scene.add(innerLight);
        const spotGold = new THREE.SpotLight(CONFIG.colors.gold, 1500);
        spotGold.position.set(30, 40, 40);
        spotGold.angle = 0.6;
        spotGold.penumbra = 0.5;
        this.scene.add(spotGold);
        const spotBlue = new THREE.SpotLight(CONFIG.colors.blueLight, 800);
        spotBlue.position.set(-30, 10, -30);
        spotBlue.angle = 0.8;
        this.scene.add(spotBlue);

        // Post-Processing
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.6, 0.5, 0.65
        );
        this.composer.addPass(bloomPass);

        this.scene.add(this.mainGroup);

        // Generate Content
        this.generateRibbon();
        this.generateParticles();
        this.generateSnow();
        
        // Remove Loader
        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 1000);
        }

        window.addEventListener('resize', this.onResize.bind(this));
        
        // Start Animation immediately
        this.animate();

        // Setup CV in background
        this.setupComputerVision();
    }

    generateRibbon() {
        const points = [];
        const h = CONFIG.treeHeight;
        const radiusBase = CONFIG.treeBaseRadius + 2;
        const turns = CONFIG.spiralTurns;
        for (let i = 0; i <= 100; i++) {
            const t = i / 100;
            const angle = t * Math.PI * 2 * turns;
            const y = (t * h) - (h / 2);
            const r = radiusBase * (1 - t);
            points.push(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
        }
        this.ribbonCurve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(this.ribbonCurve, 100, 0.1, 8, false);
        const tubeMat = new THREE.MeshStandardMaterial({ 
            color: CONFIG.colors.gold, 
            emissive: CONFIG.colors.gold,
            emissiveIntensity: 0.5,
            metalness: 1, 
            roughness: 0.2 
        });
        const ribbon = new THREE.Mesh(tubeGeo, tubeMat);
        this.mainGroup.add(ribbon);
    }

    generateParticles() {
        const matGold = new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1, roughness: 0.1 });
        const matGreen = new THREE.MeshStandardMaterial({ color: CONFIG.colors.green, roughness: 0.5 });
        const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.1, roughness: 0.2, clearcoat: 1.0 });
        const matCane = new THREE.MeshStandardMaterial({ map: createCandyCaneTexture(), roughness: 0.5 });

        const starGeo = new THREE.OctahedronGeometry(2.5, 0);
        const starMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 2.0, roughness: 0.2, metalness: 1.0 });
        this.starMesh = new THREE.Mesh(starGeo, starMat);
        this.starMesh.position.set(0, CONFIG.treeHeight/2 + 1.5, 0); 
        this.mainGroup.add(this.starMesh);

        const geoBox = new THREE.BoxGeometry(1, 1, 1);
        const geoSphere = new THREE.SphereGeometry(1, 32, 32);
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.5, 0),
            new THREE.Vector3(0.2, 0.7, 0), new THREE.Vector3(0.4, 0.5, 0)
        ]);
        const geoCane = new THREE.TubeGeometry(curve, 20, 0.12, 8, false);

        for(let i = 0; i < CONFIG.particleCount; i++) {
            let mesh: any;
            let type = 'DECO';
            const rand = Math.random();

            if (rand < 0.5) {
                mesh = new THREE.Mesh(geoBox, Math.random() > 0.6 ? matGold : (Math.random() > 0.5 ? matGreen : matRed));
                const scale = 0.5 + Math.random() * 1.5;
                mesh.scale.set(scale, scale, scale);
            } else if (rand < 0.9) {
                mesh = new THREE.Mesh(geoSphere, Math.random() > 0.5 ? matRed : matGold);
                const scale = 0.3 + Math.random() * 0.7;
                mesh.scale.set(scale, scale, scale);
            } else {
                mesh = new THREE.Mesh(geoCane, matCane);
                mesh.scale.set(1.5, 1.5, 1.5);
            }

            const y = (i / CONFIG.particleCount) * CONFIG.treeHeight - CONFIG.treeHeight / 2;
            const progress = (y + CONFIG.treeHeight/2) / CONFIG.treeHeight; 
            const maxRadius = CONFIG.treeBaseRadius * (1.1 - progress); 
            const angle = Math.random() * Math.PI * 2;
            
            const p = new Particle(mesh, type);
            const r = maxRadius * (0.6 + Math.random() * 0.5); 
            p.treePos.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

            if (i === 0) {
                // Initial placeholder photo
                this.addPhotoToScene(this.photoTextures[0], null);
            }

            mesh.userData.id = i; 
            this.mainGroup.add(mesh);
            this.particles.push(p);
        }
    }

    generateSnow() {
        const geoSnow = new THREE.BufferGeometry();
        const pos = [];
        this.snowVelocities = [];

        for(let i=0; i<CONFIG.snowCount; i++) {
            pos.push((Math.random()-0.5)*70, (Math.random()-0.5)*70 + 20, (Math.random()-0.5)*70);
            this.snowVelocities.push({
                y: - (0.05 + Math.random() * 0.15),
                x: (Math.random() - 0.5) * 0.02,
                z: (Math.random() - 0.5) * 0.02
            });
        }
        geoSnow.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);
        const tex = new THREE.CanvasTexture(canvas);

        const matSnow = new THREE.PointsMaterial({ 
            color: CONFIG.colors.white, size: 0.3, transparent: true, opacity: 0.8,
            map: tex, blending: THREE.AdditiveBlending, depthWrite: false
        });
        this.snowSystem = new THREE.Points(geoSnow, matSnow);
        this.scene.add(this.snowSystem);
    }

    // Updated to handle Aspect Ratio
    addPhotoToScene(texture: any, imgDataUrl: string | null) {
        // Default size logic if no image data yet (e.g. placeholder)
        let w = 2.6;
        let h = 2.6;

        // Calculate Aspect Ratio if image is loaded
        if (texture.image && texture.image.width && texture.image.height) {
            const aspect = texture.image.width / texture.image.height;
            const maxSize = 2.5; // Slightly smaller than frame to fit inside
            if (aspect > 1) {
                // Landscape
                w = maxSize;
                h = maxSize / aspect;
            } else {
                // Portrait or Square
                h = maxSize;
                w = maxSize * aspect;
            }
        }
        
        // Dynamic Geometry creation
        const frameW = w + 0.4;
        const frameH = h + 0.4;
        const frameGeo = new THREE.BoxGeometry(frameW, frameH, 0.1);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9 });
        
        const photoMat = new THREE.MeshBasicMaterial({ map: texture, color: 0xcccccc });
        const planeGeo = new THREE.PlaneGeometry(w, h);
        
        const frameMesh = new THREE.Mesh(frameGeo, frameMat);
        const planeMesh = new THREE.Mesh(planeGeo, photoMat);
        
        // Z-offset slightly to prevent z-fighting with frame
        planeMesh.position.set(0, 0, 0.06); 
        frameMesh.add(planeMesh);

        const p = new Particle(frameMesh, 'PHOTO');
        
        // Find position on ribbon
        if (this.ribbonCurve) {
            const t = (0.1 + (this.photoCount * 0.15)) % 0.95; 
            const point = this.ribbonCurve.getPointAt(t);
            p.treePos.copy(point);
            const lookAtPos = point.clone().add(point.clone().setY(0).normalize().multiplyScalar(10));
            frameMesh.lookAt(lookAtPos);
            frameMesh.rotateX(Math.random() * 0.2);
            frameMesh.rotateZ((Math.random() - 0.5) * 0.5);
        } else {
             p.treePos.set(0, 0, 20);
        }

        const uniqueId = 10000 + this.particles.length + Math.floor(Math.random() * 99999);
        frameMesh.userData.id = uniqueId; 
        
        this.mainGroup.add(frameMesh);
        this.particles.push(p);
        this.photoTextures.push(texture);
        this.photoCount++;

        // Add to Shuffle Pool
        this.availablePhotoIds.push(uniqueId);

        // UI Management for Gallery (Sidebar)
        if (imgDataUrl) {
            this.createPhotoUI(uniqueId, imgDataUrl);
        }
    }

    createPhotoUI(id: number, src: string) {
        const gallery = document.getElementById('gallery-sidebar');
        if (!gallery) return;

        const div = document.createElement('div');
        div.className = 'photo-item';
        div.id = `photo-${id}`;
        
        const img = document.createElement('img');
        img.src = src;
        img.className = 'photo-thumb';
        
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.innerHTML = '&times;';
        delBtn.onclick = () => this.removePhoto(id);

        div.appendChild(img);
        div.appendChild(delBtn);
        gallery.appendChild(div);
    }

    removePhoto(id: number) {
        // Find Particle
        const index = this.particles.findIndex(p => p.mesh.userData.id === id);
        if (index === -1) return;

        const p = this.particles[index];

        // 1. Remove from Scene
        this.mainGroup.remove(p.mesh);
        
        // 2. Dispose resources
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        // Traverse children to dispose plane geometry too
        p.mesh.children.forEach((c: any) => {
            if(c.geometry) c.geometry.dispose();
        });

        // 3. Remove from Array
        this.particles.splice(index, 1);

        // 4. Remove from UI
        const el = document.getElementById(`photo-${id}`);
        if (el) el.remove();

        // 5. Update Shuffle Pool
        const poolIndex = this.availablePhotoIds.indexOf(id);
        if (poolIndex > -1) {
            this.availablePhotoIds.splice(poolIndex, 1);
        }

        // 6. Handle Active Focus Case
        if (STATE.focusTargetIndex === id) {
            STATE.focusTargetIndex = -1;
            STATE.mode = CONFIG.modes.TREE; // Revert to tree mode if focusing on deleted item
        }
    }

    async setupComputerVision() {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });
            const video = document.getElementById("webcam") as HTMLVideoElement;
            const constraints = { video: { width: 320, height: 240 } };
            navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
                video.srcObject = stream;
                video.addEventListener("loadeddata", () => {
                    this.webcamRunning = true;
                });
            });
        } catch (e) {
            console.error("CV setup failed:", e);
        }
    }

    processGestures() {
        if (!this.handLandmarker || !this.webcamRunning) return;
        const video = document.getElementById("webcam");
        let results = this.handLandmarker.detectForVideo(video, performance.now());
        const labelEl = document.getElementById('gesture-label');

        if (results.landmarks && results.landmarks.length > 0) {
            STATE.handDetected = true;
            const landmarks = results.landmarks[0];
            const palm = landmarks[9];
            const targetRotY = (palm.x - 0.5) * 2; 
            const targetRotX = (palm.y - 0.5) * 2;
            STATE.rotationTarget = { x: targetRotX, y: targetRotY };

            const d8  = Math.hypot(landmarks[8].x - landmarks[0].x, landmarks[8].y - landmarks[0].y); 
            const d12 = Math.hypot(landmarks[12].x - landmarks[0].x, landmarks[12].y - landmarks[0].y); 
            const d16 = Math.hypot(landmarks[16].x - landmarks[0].x, landmarks[16].y - landmarks[0].y); 
            const d20 = Math.hypot(landmarks[20].x - landmarks[0].x, landmarks[20].y - landmarks[0].y); 
            const pinchDist = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);
            const avgDist = (d8 + d12 + d16 + d20) / 4;
            const isVictory = (d8 > 0.25 && d12 > 0.25) && (d16 < 0.2 && d20 < 0.2);

            let detectedGesture = "Hand Detected";

            if (pinchDist < 0.05) {
                STATE.mode = CONFIG.modes.FOCUS;
                detectedGesture = "Pinch (Focus)";
                
                // --- SHUFFLE LOGIC IMPLEMENTATION ---
                // If currently not focused on a valid photo, pick a new one
                if (STATE.focusTargetIndex === -1) {
                    const allPhotos = this.particles.filter(p => p.type === 'PHOTO');
                    if (allPhotos.length > 0) {
                        // Refill pool if empty
                        if (this.availablePhotoIds.length === 0) {
                            this.availablePhotoIds = allPhotos.map(p => p.mesh.userData.id);
                        }

                        // Pick random from available
                        const randIdx = Math.floor(Math.random() * this.availablePhotoIds.length);
                        const nextId = this.availablePhotoIds[randIdx];

                        // Remove chosen ID from pool (so it doesn't repeat until reset)
                        this.availablePhotoIds.splice(randIdx, 1);
                        
                        STATE.focusTargetIndex = nextId;
                    }
                }
            } else if (isVictory) {
                STATE.mode = CONFIG.modes.HEART;
                STATE.focusTargetIndex = -1;
                detectedGesture = "Victory (Heart)";
            } else if (avgDist < 0.25) {
                STATE.mode = CONFIG.modes.TREE;
                STATE.focusTargetIndex = -1;
                detectedGesture = "Fist (Tree)";
            } else if (avgDist > 0.4) {
                STATE.mode = CONFIG.modes.SCATTER;
                STATE.focusTargetIndex = -1;
                detectedGesture = "Open Hand (Scatter)";
            }
            if(labelEl) labelEl.innerText = detectedGesture;
        } else {
            STATE.handDetected = false;
            STATE.rotationTarget.x = STATE.rotationTarget.x * 0.95;
            STATE.rotationTarget.y = STATE.rotationTarget.y * 0.95;
            if(labelEl) labelEl.innerText = "No Hand Detected";
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        
        const dt = this.clock.getDelta();
        this.processGestures();

        const lerpFactor = 0.05;
        this.mainGroup.rotation.y += (STATE.rotationTarget.y - this.mainGroup.rotation.y) * lerpFactor;
        this.mainGroup.rotation.x += (STATE.rotationTarget.x - this.mainGroup.rotation.x) * lerpFactor;
        
        if (STATE.mode === CONFIG.modes.TREE && !STATE.handDetected) {
            this.mainGroup.rotation.y += 0.002;
        }

        if(this.starMesh) {
            this.starMesh.rotation.y += 0.01;
            this.starMesh.rotation.z = Math.sin(this.clock.getElapsedTime()) * 0.1;
        }

        this.particles.forEach(p => {
            if (STATE.mode === CONFIG.modes.TREE) {
                p.targetPosition.copy(p.treePos);
            } else if (STATE.mode === CONFIG.modes.SCATTER) {
                p.targetPosition.copy(p.scatterPos);
            } else if (STATE.mode === CONFIG.modes.HEART) {
                p.targetPosition.copy(p.heartPos);
            } else if (STATE.mode === CONFIG.modes.FOCUS) {
                if (p.type === 'PHOTO' && p.mesh.userData.id === STATE.focusTargetIndex) {
                    // --- FOCUS MODE UPDATE: Z = 65 ---
                    const desiredWorldPos = new THREE.Vector3(0, 5, 65);
                    const invRot = new THREE.Quaternion();
                    invRot.copy(this.mainGroup.quaternion).invert();
                    desiredWorldPos.applyQuaternion(invRot);
                    p.targetPosition.copy(desiredWorldPos);
                    
                    p.mesh.rotation.x = -this.mainGroup.rotation.x;
                    p.mesh.rotation.y = -this.mainGroup.rotation.y;
                    p.mesh.rotation.z = -this.mainGroup.rotation.z;
                } else {
                    p.targetPosition.copy(p.scatterPos).multiplyScalar(1.5);
                }
            }
            p.update(dt, this.mainGroup.rotation);
        });

        if (this.snowSystem) {
            const positions = this.snowSystem.geometry.attributes.position.array;
            for(let i=0; i<CONFIG.snowCount; i++) {
                positions[i*3+1] += this.snowVelocities[i].y;
                positions[i*3] += this.snowVelocities[i].x;
                positions[i*3+2] += this.snowVelocities[i].z;
                if(positions[i*3+1] < -20) {
                    positions[i*3+1] = 25;
                    positions[i*3] = (Math.random()-0.5)*70;
                    positions[i*3+2] = (Math.random()-0.5)*70;
                }
            }
            this.snowSystem.geometry.attributes.position.needsUpdate = true;
            this.snowSystem.rotation.y += 0.001;
        }

        this.composer.render();
    }
}

// React Entry
function App() {
  const appRef = useRef<ChristmasApp | null>(null);

  useEffect(() => {
    if (!appRef.current) {
      appRef.current = new ChristmasApp();
      appRef.current.init();
    }
    
    const handleKey = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() === 'h') {
            const title = document.querySelector('#title');
            const ui = document.querySelector('#ui-container');
            const gallery = document.querySelector('#gallery-sidebar');
            if(title) title.classList.toggle('ui-hidden');
            if(ui) ui.classList.toggle('ui-hidden');
            if(gallery) gallery.classList.toggle('ui-hidden');
        }
    };
    
    const fileInput = document.getElementById('imageInput') as HTMLInputElement;
    const handleFile = (e: any) => {
        // Handle Multiple Files
        const files = e.target.files;
        if (!files || files.length === 0) return;

        // Iterate through all selected files
        Array.from(files).forEach((f: any) => {
            const reader = new FileReader();
            reader.onload = (ev: any) => {
                const result = ev.target.result;
                new THREE.TextureLoader().load(result, (t: any) => {
                    t.colorSpace = THREE.SRGBColorSpace;
                    // Pass the base64 string for UI generation
                    if(appRef.current) appRef.current.addPhotoToScene(t, result);
                });
            };
            reader.readAsDataURL(f);
        });

        // Reset input so same files can be selected again if needed
        e.target.value = '';
    };

    document.addEventListener('keydown', handleKey);
    if(fileInput) fileInput.addEventListener('change', handleFile);

    return () => {
        document.removeEventListener('keydown', handleKey);
        if(fileInput) fileInput.removeEventListener('change', handleFile);
    };
  }, []);

  return null; 
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
