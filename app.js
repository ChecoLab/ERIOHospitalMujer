// --- CONFIGURACIÓN E INICIALIZACIÓN ---
let db = null;
let userProfile = null;
let activeAlertId = null;
const APP_ID = 'hospital_mujer_prod_v1';

document.addEventListener('DOMContentLoaded', () => {
    // Intentar recuperar sesión y configuración
    const savedConfig = localStorage.getItem('erio_prod_config');
    const savedProfile = localStorage.getItem('erio_profile');

    if (savedProfile) userProfile = JSON.parse(savedProfile);

    if (savedConfig) {
        initFirebase(JSON.parse(savedConfig));
    } else {
        showView('view-setup');
    }
});

function showView(id) {
    // Ocultar todo
    ['view-setup', 'view-register', 'view-dashboard', 'view-alert'].forEach(v => {
        document.getElementById(v).classList.add('hidden');
    });
    // Mostrar la vista deseada
    document.getElementById(id).classList.remove('hidden');
}

// --- 1. CONFIGURACIÓN ---
function smartSaveConfig() {
    let input = document.getElementById('firebase-config-input').value.trim();
    if (input.indexOf('=') > -1) input = input.substring(input.indexOf('=') + 1);
    if (input.endsWith(';')) input = input.substring(0, input.length - 1);

    let config = null;
    try {
        config = JSON.parse(input);
    } catch (e) {
        try {
            config = new Function("return " + input)();
        } catch (e2) {
            document.getElementById('setup-error').classList.remove('hidden');
            return;
        }
    }

    if (config && config.apiKey) {
        localStorage.setItem('erio_prod_config', JSON.stringify(config));
        location.reload();
    } else {
        document.getElementById('setup-error').classList.remove('hidden');
    }
}

// --- 2. CONEXIÓN ---
async function initFirebase(config) {
    try {
        if (!firebase.apps.length) firebase.initializeApp(config);
        const auth = firebase.auth();
        db = firebase.firestore();

        await auth.signInAnonymously();
        
        if (userProfile) {
            startListening();
        } else {
            showView('view-register');
        }
    } catch(e) {
        alert("Error de conexión. Verifica internet.");
        // Si falla 2 veces, ofrecer reset
        console.error(e);
    }
}

// --- 3. USUARIO ---
function registerUser() {
    const name = document.getElementById('reg-name').value;
    const role = document.getElementById('reg-role').value;
    if(!name.trim()) return alert("Nombre obligatorio.");
    
    userProfile = { id: firebase.auth().currentUser.uid, name, role };
    localStorage.setItem('erio_profile', JSON.stringify(userProfile));
    startListening();
}

function resetApp() {
    if(confirm("¿Cerrar sesión en este dispositivo?")) {
        localStorage.clear();
        location.reload();
    }
}

// --- 4. LISTENER TIEMPO REAL ---
function startListening() {
    document.getElementById('user-display').textContent = `${userProfile.name} (${userProfile.role})`;
    
    db.collection('artifacts').doc(APP_ID).collection('alerts')
      .orderBy('startTime', 'desc')
      .limit(10)
      .onSnapshot(snapshot => {
          const alerts = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          const active = alerts.find(a => a.status === 'active');

          if (active) {
              if (activeAlertId !== active.id) {
                  playAlarm();
                  if("vibrate" in navigator) navigator.vibrate([500, 200, 500, 200, 1000]);
              }
              activeAlertId = active.id;
              renderAlertScreen(active);
              showView('view-alert');
          } else {
              activeAlertId = null;
              renderHistory(alerts);
              showView('view-dashboard');
          }
      });
}

// --- 5. ACCIONES ---
async function activateAlert() {
    const loc = document.getElementById('alert-location').value;
    const sit = document.getElementById('alert-situation').value;
    
    if(!loc) return alert("Selecciona ubicación");
    if(!sit) return alert("Describe la situación");

    try {
        await db.collection('artifacts').doc(APP_ID).collection('alerts').add({
            status: 'active',
            location: loc,
            situation: sit,
            activatorName: userProfile.name,
            activatorRole: userProfile.role,
            startTime: firebase.firestore.FieldValue.serverTimestamp(),
            responders: []
        });
        document.getElementById('alert-situation').value = "";
    } catch(e) { alert("Error: " + e.message); }
}

async function respondToAlert() {
    if(!activeAlertId) return;
    const responder = {
        userId: userProfile.id,
        name: userProfile.name,
        role: userProfile.role,
        timestamp: new Date().toISOString()
    };
    await db.collection('artifacts').doc(APP_ID).collection('alerts').doc(activeAlertId).update({
        responders: firebase.firestore.FieldValue.arrayUnion(responder)
    });
}

async function deactivateAlert() {
    const report = document.getElementById('final-report').value;
    if(!report.trim()) return alert("Reporte obligatorio.");
    if(confirm("¿Finalizar código?")) {
        await db.collection('artifacts').doc(APP_ID).collection('alerts').doc(activeAlertId).update({
            status: 'resolved',
            finalReport: report,
            endTime: firebase.firestore.FieldValue.serverTimestamp()
        });
        document.getElementById('final-report').value = "";
    }
}

// --- 6. RENDER ---
function renderAlertScreen(data) {
    document.getElementById('panic-situation').textContent = data.situation;
    document.getElementById('panic-location').textContent = data.location;
    document.getElementById('panic-activator').textContent = data.activatorRole;
    
    const list = document.getElementById('responders-list');
    list.innerHTML = '';
    const responders = data.responders || [];
    document.getElementById('responders-count').textContent = responders.length;

    responders.forEach(r => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center p-2 bg-white bg-opacity-20 rounded mb-1 text-white';
        div.innerHTML = `<span class="font-bold text-sm">${r.name}</span><span class="text-xs opacity-90">${r.role}</span>`;
        list.appendChild(div);
    });

    const iResponded = responders.some(r => r.userId === userProfile.id);
    if(iResponded) {
        document.getElementById('btn-respond').classList.add('hidden');
        document.getElementById('response-confirmed').classList.remove('hidden');
    } else {
        document.getElementById('btn-respond').classList.remove('hidden');
        document.getElementById('response-confirmed').classList.add('hidden');
    }
}

function renderHistory(alerts) {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    const resolved = alerts.filter(a => a.status !== 'active');
    
    if (resolved.length === 0) {
        list.innerHTML = '<div class="text-center text-xs text-gray py-4">Sin actividad reciente</div>';
        return;
    }

    resolved.forEach(a => {
        const div = document.createElement('div');
        div.className = 'bg-white p-3 rounded shadow-sm border-l-4 border-gray-300';
        div.innerHTML = `
            <div class="font-bold text-sm text-dark">${a.situation}</div>
            <div class="text-xs text-gray mt-1 flex justify-between">
                <span>📍 ${a.location}</span>
                <span>👤 ${a.activatorRole}</span>
            </div>
            ${a.finalReport ? `<div class="mt-2 text-xs italic text-gray bg-gray-50 p-1 rounded">📋 "${a.finalReport}"</div>` : ''}
        `;
        list.appendChild(div);
    });
}

function playAlarm() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.5);
        osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start(); osc.stop(ctx.currentTime + 1);
    } catch(e) {}
}