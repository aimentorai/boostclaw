import { createGlobalStyle } from "antd-style";
import { ConfigProvider, bailianTheme } from "@agentscope-ai/design";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import LoginPage from "./pages/Auth/Login";
import { AuthProvider } from "./auth/context";
import RequireAuth from "./auth/RequireAuth";
import "./styles/layout.css";
import "./styles/form-override.css";

const GlobalStyle = createGlobalStyle`
* {
  margin: 0;
  box-sizing: border-box;
}
`;

function App() {
  return (
    <BrowserRouter>
      <GlobalStyle />
      <ConfigProvider {...bailianTheme} prefix="copaw" prefixCls="copaw">
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route element={<RequireAuth />}>
              <Route path="/*" element={<MainLayout />} />
            </Route>
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </AuthProvider>
      </ConfigProvider>
    </BrowserRouter>
  );
}

export default App;
