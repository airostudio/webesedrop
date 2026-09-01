import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setStoredAdminKey } from "../api";

export function Login() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStoredAdminKey(key.trim());
    try {
      await api.overview();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Dropship Engine Admin</h1>
        <p className="muted">Enter the engine's ADMIN_API_KEY to continue.</p>
        <input
          type="password"
          placeholder="Admin API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          required
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading || key.trim().length === 0}>
          {loading ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
