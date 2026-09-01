import { Navigate, Route, Routes } from "react-router-dom";
import { getStoredAdminKey } from "./api";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Stores } from "./pages/Stores";
import { StoreDetail } from "./pages/StoreDetail";
import { Domains } from "./pages/Domains";
import { Billing } from "./pages/Billing";
import { Reports } from "./pages/Reports";

function RequireAdminKey({ children }: { children: JSX.Element }) {
  return getStoredAdminKey() ? children : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAdminKey>
            <Layout />
          </RequireAdminKey>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/stores/:id" element={<StoreDetail />} />
        <Route path="/domains" element={<Domains />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
    </Routes>
  );
}
