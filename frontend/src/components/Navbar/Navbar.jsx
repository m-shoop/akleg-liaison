import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const { isLoggedIn, username, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" className={styles.brand}>
          AK Leg Liaison
        </NavLink>

        <ul className={styles.links}>
          <li>
            <NavLink
              to="/"
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
              end
            >
              Bills
            </NavLink>
          </li>
          {isLoggedIn && (
            <li>
              <NavLink
                to="/query-bill"
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.active}` : styles.link
                }
              >
                Query Bill
              </NavLink>
            </li>
          )}
        </ul>

        <div className={styles.authArea}>
          {isLoggedIn ? (
            <>
              <span className={styles.username}>{username}</span>
              <button className={styles.logoutBtn} onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <NavLink to="/login" className={styles.loginBtn}>
              Log in
            </NavLink>
          )}
        </div>
      </nav>
    </header>
  );
}
