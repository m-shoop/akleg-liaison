import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const { isLoggedIn, can, username, logout, isTokenExpired } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" className={styles.brand}>
          Leg Up - Legislative Reporting
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
              Legislation
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/meetings"
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              Hearings
            </NavLink>
          </li>
          <li className={styles.dropdown}>
            <button className={styles.dropdownBtn}>Helpful Links ▾</button>
            <ul className={styles.dropdownMenu}>
              <li>
                <a
                  href="https://www.legfin.akleg.gov/FiscalNotes/allNotes.php"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.dropdownItem}
                >
                  Fiscal Notes
                </a>
              </li>
              <li>
                <a
                  href="https://omb.alaska.gov/forms-and-manuals/"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.dropdownItem}
                >
                  OMB Forms and Manuals
                </a>
              </li>
            </ul>
          </li>
          {can("bill:query") && (
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
              <span className={`${styles.username} ${isTokenExpired ? styles.usernameExpired : ""}`}>
                {isTokenExpired && <span className={styles.expiryIcon} title="Session expired">⚠</span>}
                {username}
              </span>
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
