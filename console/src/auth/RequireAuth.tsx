import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

export default function RequireAuth() {
  const { isAuthenticated, hydrated } = useAuth();
  const location = useLocation();

  // Wait for desktop auth hydration before making redirect decisions.
  if (!hydrated) {
    return null;
  }

  if (!isAuthenticated) {
    const redirect = encodeURIComponent(
      `${location.pathname}${location.search}${location.hash}`,
    );
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }

  return <Outlet />;
}


