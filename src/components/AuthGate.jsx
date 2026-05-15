import { useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabaseClient';

export function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabaseConfigured || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return children;
  if (loading) return <div className="auth-screen"><div className="card">Načítám přihlášení…</div></div>;
  if (session) return children;

  const signIn = async (event) => {
    event.preventDefault();
    setMessage('Přihlašuji…');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
  };

  const signUp = async () => {
    setMessage('Vytvářím účet…');
    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(error ? error.message : 'Účet vytvořen. Pokud máš zapnuté potvrzení e-mailu, potvrď ho a přihlas se.');
  };

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={signIn}>
        <div className="brand-badge">PS</div>
        <h1>Pokladní systém</h1>
        <p className="muted">Supabase režim je zapnutý. Přihlas se, aby se produkty, prodeje, sklad a příjemky ukládaly do databáze.</p>
        <label>E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Heslo
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength="6" />
        </label>
        {message ? <div className="info-card compact-message">{message}</div> : null}
        <div className="form-actions">
          <button type="button" className="ghost-button" onClick={signUp}>Vytvořit účet</button>
          <button className="primary-button" type="submit">Přihlásit</button>
        </div>
      </form>
    </div>
  );
}
