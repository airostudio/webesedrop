import { NavLink, Outlet } from "react-router-dom";
import { clearStoredAdminKey } from "../api";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/stores", label: "Stores" },
  { to: "/domains", label: "Domains" },
  { to: "/billing", label: "Billing" },
  { to: "/reports", label: "Reports" },
];

export function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Dropship Engine</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="signout"
          onClick={() => {
            clearStoredAdminKey();
            window.location.href = "/";
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
