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
import styles from "./App.module.css";

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <main className={styles.main}>
        <SessionExpiredBanner />
        <Routes>
          <Route path="/"           element={<Home />} />
          <Route path="/login"      element={<Login />} />
          <Route path="/query-bill" element={<QueryBill />} />
          <Route path="/hearings"   element={<Hearings />} />
          <Route path="/meetings"   element={<Navigate to="/hearings" replace />} />
        </Routes>
      </main>
      <Footer />
      <ReauthModal />
    </AuthProvider>
  );
}
