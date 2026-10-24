import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 네트워크 및 UI 설정
const socket = io();
let currentRoom = null;

const uiContainer = document.getElementById('ui-container');
const gameContainer = document.getElementById('game-container');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const inputRoom = document.getElementById('input-room');

// Three.js 씬 초기화
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // 맑은 하늘색 (파스텔)
scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// 조명 설정 (부드러운 조명)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 40, 20);
dirLight.castShadow = true;
scene.add(dirLight);

// GLTF 로더 설정
const gltfLoader = new GLTFLoader();

// 모델 로딩 헬퍼 함수 (물리와 시각 객체 분리)
function createEntity(modelPath, fallbackGeometry, fallbackMaterial, config = {}) {
    const group = new THREE.Group();
    
    // 1. 물리용 보이지 않는 충돌체(AABB)
    const physicsMesh = new THREE.Mesh(fallbackGeometry, fallbackMaterial);
    physicsMesh.visible = false; // 실제 게임에선 숨김 (디버깅시 true)
    group.add(physicsMesh);
    group.physicsMesh = physicsMesh;

    // 2. 외부 3D 모델 로딩
    gltfLoader.load(
        modelPath,
        (gltf) => {
            const model = gltf.scene;
            if (config.scale) model.scale.set(config.scale, config.scale, config.scale);
            if (config.offsetY) model.position.y = config.offsetY;
            
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            group.add(model);
            group.visualModel = model;
        },
        undefined,
        (error) => {
            console.warn(`${modelPath} 로드 실패. 임시 모델로 대체합니다.`, error);
            // 로드 실패 시 물리 메쉬를 보이게 하여 임시 모델로 사용
            physicsMesh.visible = true; 
        }
    );

    return group;
}

// 게임 객체들
let localPlayer;
const players = {};
const clouds = [];

// 플레이어 설정
const playerGeo = new THREE.BoxGeometry(1, 1.5, 1);
const playerMat = new THREE.MeshStandardMaterial({ color: 0xffb6c1 }); // 파스텔 핑크
const playerSpeed = 10;
const jumpForce = 15;
let velocityY = 0;
let isGrounded = false;
const gravity = 30;

// 입력 키 상태
const keys = { w: false, a: false, s: false, d: false, space: false };
window.addEventListener('keydown', (e) => {
    if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = true;
    if(e.key === ' ' && isGrounded) { velocityY = jumpForce; isGrounded = false; }
});
window.addEventListener('keyup', (e) => {
    if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = false;
});

// 게임 시작 로직
function startGame(roomCode) {
    uiContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    gameContainer.appendChild(renderer.domElement);
    
    // 로컬 플레이어 생성
    localPlayer = createEntity(
        'models/player.glb', 
        playerGeo, 
        playerMat, 
        { scale: 0.5, offsetY: -0.75 }
    );
    localPlayer.position.set(0, 5, 0);
    scene.add(localPlayer);

    // 구름(발판) 맵 생성 - 구름 타워 기초
    const cloudGeo = new THREE.BoxGeometry(4, 1, 4);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    
    for (let i = 0; i < 10; i++) {
        const cloud = createEntity('models/cloud.glb', cloudGeo, cloudMat, { scale: 1 });
        cloud.position.set(i * 5, i * 2, -i * 5);
        cloud.cloudId = `cloud_${i}`;
        cloud.state = 'normal';
        scene.add(cloud);
        clouds.push(cloud);
    }

    currentRoom = roomCode;
    animate();
}

// 메인 게임 루프
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (localPlayer) {
        // 이동 로직
        const moveDir = new THREE.Vector3();
        if (keys.w) moveDir.z -= 1;
        if (keys.s) moveDir.z += 1;
        if (keys.a) moveDir.x -= 1;
        if (keys.d) moveDir.x += 1;
        
        moveDir.normalize();
        localPlayer.position.add(moveDir.multiplyScalar(playerSpeed * delta));

        // 중력 및 점프
        velocityY -= gravity * delta;
        localPlayer.position.y += velocityY * delta;

        // 임시 바닥 및 구름 충돌 판정
        isGrounded = false;
        
        // 바닥(추락 방지용)
        if (localPlayer.position.y < 0.75) {
            localPlayer.position.y = 0.75;
            velocityY = 0;
            isGrounded = true;
        }

        // 구름 AABB 충돌 및 붕괴 로직
        const playerBox = new THREE.Box3().setFromObject(localPlayer.physicsMesh);
        
        clouds.forEach(cloud => {
            if (cloud.state === 'falling') return;

            const cloudBox = new THREE.Box3().setFromObject(cloud.physicsMesh);
            
            if (playerBox.intersectsBox(cloudBox)) {
                // 머리가 뚫리는 것을 방지하고 위에서 밟았을 때만 판정
                if (velocityY < 0 && localPlayer.position.y > cloud.position.y) {
                    localPlayer.position.y = cloudBox.max.y + 0.75;
                    velocityY = 0;
                    isGrounded = true;

                    if (cloud.state === 'normal') {
                        cloud.state = 'pressed';
                        socket.emit('cloudStepped', { roomCode: currentRoom, cloudId: cloud.cloudId });
                        triggerCloudCollapse(cloud);
                    }
                }
            }
        });

        // 카메라 추적 (간단한 3인칭)
        camera.position.x = localPlayer.position.x;
        camera.position.y = localPlayer.position.y + 8;
        camera.position.z = localPlayer.position.z + 12;
        camera.lookAt(localPlayer.position);

        // 서버로 내 위치 전송
        socket.emit('playerMove', { 
            roomCode: currentRoom, 
            position: localPlayer.position, 
            rotation: localPlayer.rotation.y 
        });
    }

    renderer.render(scene, camera);
}

// 구름 붕괴 효과
function triggerCloudCollapse(cloud) {
    // 1단계: 눌림 효과
    cloud.position.y -= 0.2;
    
    // 2단계: 0.5초 후 흔들림 & 추락
    setTimeout(() => {
        cloud.state = 'falling';
        // 간단한 추락 애니메이션 (실제로는 update 루프에서 y값을 빼주도록 확장)
        cloud.position.y -= 10; 
    }, 500);
}

// 네트워크 이벤트 리스너
btnCreate.addEventListener('click', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    socket.emit('joinRoom', roomCode);
});

btnJoin.addEventListener('click', () => {
    const code = inputRoom.value.trim().toUpperCase();
    if (code) socket.emit('joinRoom', code);
});

socket.on('roomJoined', (roomCode) => {
    startGame(roomCode);
    console.log(`방 참가 성공: ${roomCode}`);
});

socket.on('playerMoved', (data) => {
    if (!players[data.id]) {
        // 다른 유저 캐릭터 생성
        players[data.id] = createEntity('models/player.glb', playerGeo, playerMat, { scale: 0.5, offsetY: -0.75 });
        scene.add(players[data.id]);
    }
    players[data.id].position.copy(data.position);
});

socket.on('cloudStateChanged', (data) => {
    const cloud = clouds.find(c => c.cloudId === data.cloudId);
    if (cloud && cloud.state === 'normal') {
        cloud.state = 'pressed';
        triggerCloudCollapse(cloud);
    }
});

socket.on('playerDisconnected', (id) => {
    if (players[id]) {
        scene.remove(players[id]);
        delete players[id];
    }
});