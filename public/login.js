document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (r.ok) {
      window.location.href = '/';
    } else {
      const data = await r.json().catch(() => ({}));
      errEl.textContent = data.error || 'Identifiants incorrects';
      errEl.style.display = '';
    }
  } catch (err) {
    errEl.textContent = 'Erreur de connexion au serveur';
    errEl.style.display = '';
  }
});
