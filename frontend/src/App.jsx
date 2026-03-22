import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Navbar from "./components/Navbar/Navbar";
import Footer from "./components/Footer/Footer";
import Home from "./pages/Home/Home";
import Login from "./pages/Login/Login";
import QueryBill from "./pages/QueryBill/QueryBill";
import styles from "./App.module.css";

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <main className={styles.main}>
        <Routes>
          <Route path="/"           element={<Home />} />
          <Route path="/login"      element={<Login />} />
          <Route path="/query-bill" element={<QueryBill />} />
        </Routes>
      </main>
      <Footer />
    </AuthProvider>
  );
}
