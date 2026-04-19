import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Navbar from "./components/Navbar/Navbar";
import Footer from "./components/Footer/Footer";
import ReauthModal from "./components/ReauthModal/ReauthModal";
import SessionExpiredBanner from "./components/SessionExpiredBanner/SessionExpiredBanner";
import Home from "./pages/Home/Home";
import Login from "./pages/Login/Login";
import QueryBill from "./pages/QueryBill/QueryBill";
import Hearings from "./pages/Hearings/Hearings";
import Requests from "./pages/Requests/Requests";
import Register from "./pages/Register/Register";
import ForgotPassword from "./pages/ForgotPassword/ForgotPassword";
import ActivateToken from "./pages/ActivateToken/ActivateToken";
import SetPassword from "./pages/SetPassword/SetPassword";
import styles from "./App.module.css";

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <main className={styles.main}>
        <SessionExpiredBanner />
        <Routes>
          <Route path="/"                element={<Home />} />
          <Route path="/login"           element={<Login />} />
          <Route path="/register"        element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/activate"        element={<ActivateToken />} />
          <Route path="/set-password"    element={<SetPassword />} />
          <Route path="/query-bill"      element={<QueryBill />} />
          <Route path="/hearings"   element={<Hearings />} />
          <Route path="/meetings"        element={<Navigate to="/hearings" replace />} />
          <Route path="/requests"        element={<Requests />} />
        </Routes>
      </main>
      <Footer />
      <ReauthModal />
    </AuthProvider>
  );
}
