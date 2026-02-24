// API URL - apunta a tu backend
const API_URL = 'http://localhost:3000';

// Estado de la aplicación
let currentUser = null;

// Elementos del DOM
const registerSection = document.getElementById('register-section');
const mainSection = document.getElementById('main-section');
const registerForm = document.getElementById('register-form');
const userEmail = document.getElementById('user-email');
const userPlan = document.getElementById('user-plan');
const generateBtn = document.getElementById('generate-btn');
const productDetails = document.getElementById('product-details');
const toneSelect = document.getElementById('tone');
const outputSection = document.getElementById('output-section');
const descriptionOutput = document.getElementById('description-output');
const loading = document.getElementById('loading');
const copyBtn = document.getElementById('copy-btn');
const historyList = document.getElementById('history-list');

// ============================================
// REGISTRO DE USUARIO
// ============================================

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const full_name = document.getElementById('full-name').value;

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, full_name })
        });

        const data = await response.json();

        if (data.success) {
            // Guardar usuario en localStorage
            currentUser = {
                id: data.user_id,
                email: email,
                plan: 'free'
            };
            localStorage.setItem('user', JSON.stringify(currentUser));
            
            // Mostrar sección principal
            showMainSection();
            
            // Cargar historial
            loadHistory();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error conectando al servidor');
        console.error(error);
    }
});

// ============================================
// GENERAR DESCRIPCIÓN
// ============================================

generateBtn.addEventListener('click', async () => {
    const details = productDetails.value.trim();
    
    if (!details) {
        alert('Please enter product details');
        return;
    }

    if (!currentUser) {
        alert('Please register first');
        return;
    }

    // Mostrar loading
    loading.style.display = 'block';
    outputSection.style.display = 'none';

    try {
        const response = await fetch(`${API_URL}/generate-description`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                user_id: currentUser.id,
                product_details: details,
                tone: toneSelect.value
            })
        });

        const data = await response.json();

        if (data.success) {
            descriptionOutput.textContent = data.description;
            outputSection.style.display = 'block';
            
            // Actualizar plan si cambió
            if (data.plan) {
                currentUser.plan = data.plan;
                updateUserInfo();
            }
            
            // Recargar historial
            loadHistory();
        } else {
            if (data.error.includes('Límite')) {
                alert(`⚠️ ${data.error}\nPlan: ${data.plan}\nUsados: ${data.current}/${data.limit}`);
            } else {
                alert('Error: ' + data.error);
            }
        }
    } catch (error) {
        alert('Error conectando al servidor');
        console.error(error);
    } finally {
        loading.style.display = 'none';
    }
});

// ============================================
// COPIAR AL PORTAPAPELES
// ============================================

copyBtn.addEventListener('click', () => {
    const text = descriptionOutput.textContent;
    navigator.clipboard.writeText(text).then(() => {
        alert('Description copied!');
    });
});

// ============================================
// CARGAR HISTORIAL
// ============================================

async function loadHistory() {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_URL}/my-descriptions/${currentUser.id}`);
        const data = await response.json();

        if (data.success) {
            displayHistory(data.descriptions);
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

function displayHistory(descriptions) {
    if (!descriptions || descriptions.length === 0) {
        historyList.innerHTML = '<p>No descriptions yet. Generate your first one!</p>';
        return;
    }

    let html = '';
    descriptions.slice(0, 5).forEach(desc => {
        const date = new Date(desc.created_at).toLocaleDateString();
        html += `
            <div class="history-item">
                <div class="history-product">📝 ${desc.product_details.substring(0, 50)}...</div>
                <div class="history-description">${desc.generated_description.substring(0, 100)}...</div>
                <div class="history-date">${date}</div>
            </div>
        `;
    });

    historyList.innerHTML = html;
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function showMainSection() {
    registerSection.style.display = 'none';
    mainSection.style.display = 'block';
    updateUserInfo();
}

function updateUserInfo() {
    if (currentUser) {
        userEmail.textContent = currentUser.email;
        userPlan.textContent = currentUser.plan === 'free' ? 'Free Plan' : 
                               currentUser.plan === 'pro' ? 'Pro Plan' : 'Business Plan';
    }
}

// ============================================
// INICIALIZACIÓN
// ============================================

// Verificar si hay usuario guardado
const savedUser = localStorage.getItem('user');
if (savedUser) {
    currentUser = JSON.parse(savedUser);
    showMainSection();
    loadHistory();
}
