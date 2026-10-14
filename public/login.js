const REMEMBER_KEY = 'ab2s-identifiant';
const usernameInput = document.getElementById('l-username');
const passwordInput = document.getElementById('l-password');
const rememberInput = document.getElementById('l-remember');

// Seul l'identifiant peut être mémorisé — le mot de passe est toujours demandé
let saved = null;
try { saved = localStorage.getItem(REMEMBER_KEY); } catch (e) {}
if (saved) {
  usernameInput.value = saved;
  rememberInput.checked = true;
  passwordInput.focus();
} else {
  usernameInput.focus();
}

if (new URLSearchParams(location.search).get('expired')) {
  document.getElementById('login-info').classList.add('show');
}

document.getElementById('pw-toggle').addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  document.getElementById('pw-icon').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  passwordInput.focus();
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Connexion…';
  const showError = msg => {
    errEl.innerHTML = '<svg class="i i-sm"><use href="#i-alert"/></svg><span></span>';
    errEl.querySelector('span').textContent = msg;
    errEl.style.display = 'flex';
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  };

  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (r.ok) {
      try {
        if (rememberInput.checked) localStorage.setItem(REMEMBER_KEY, username);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch (err) {}
      window.location.href = '/';
    } else {
      const data = await r.json().catch(() => ({}));
      showError(data.error || 'Identifiants incorrects');
      passwordInput.select();
    }
  } catch (err) {
    showError('Erreur de connexion au serveur');
  }
});
