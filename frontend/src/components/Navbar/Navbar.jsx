import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { fetchHasOpen } from "../../api/workflows";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const { isLoggedIn, can, username, logout, isTokenExpired, token } = useAuth();
  const navigate = useNavigate();
  const [hasOpenTasks, setHasOpenTasks] = useState(false);

  useEffect(() => {
    if (!token) {
      setHasOpenTasks(false);
      return;
    }
    fetchHasOpen(token).then((data) => setHasOpenTasks(data.has_open ?? false));
  }, [token]);

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" className={styles.brand}>
          Leg Up<span className={styles.brandSuffix}> - Legislative Reporting</span>
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
              to="/hearings"
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              Hearings
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/requests"
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              Tasks
              {hasOpenTasks && <span className={styles.openBadge} />}
            </NavLink>
          </li>
          <li className={`${styles.dropdown} ${styles.desktopOnly}`}>
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
          <li className={`${styles.dropdown} ${!isLoggedIn ? styles.mobileOnly : ""}`}>
              <button className={styles.dropdownBtn}>&#9776;</button>
              <ul className={`${styles.dropdownMenu} ${styles.dropdownMenuRight}`}>
                <li className={styles.mobileOnlyItem}>
                  <a
                    href="https://www.legfin.akleg.gov/FiscalNotes/allNotes.php"
                    target="_blank"
                    rel="noreferrer"
                    className={styles.dropdownItem}
                  >
                    Fiscal Notes
                  </a>
                </li>
                <li className={styles.mobileOnlyItem}>
                  <a
                    href="https://omb.alaska.gov/forms-and-manuals/"
                    target="_blank"
                    rel="noreferrer"
                    className={styles.dropdownItem}
                  >
                    OMB Forms and Manuals
                  </a>
                </li>
                {can("bill:query") && (
                  <li>
                    <NavLink
                      to="/query-bill"
                      className={({ isActive }) =>
                        isActive
                          ? `${styles.dropdownItem} ${styles.dropdownItemActive}`
                          : styles.dropdownItem
                      }
                    >
                      Query Bill
                    </NavLink>
                  </li>
                )}
                {can("email-template:edit") && (
                  <li>
                    <NavLink
                      to="/email-templates"
                      className={({ isActive }) =>
                        isActive
                          ? `${styles.dropdownItem} ${styles.dropdownItemActive}`
                          : styles.dropdownItem
                      }
                    >
                      Email Templates
                    </NavLink>
                  </li>
                )}
                {isLoggedIn && (
                  <li>
                    <NavLink
                      to="/settings"
                      className={({ isActive }) =>
                        isActive
                          ? `${styles.dropdownItem} ${styles.dropdownItemActive}`
                          : styles.dropdownItem
                      }
                    >
                      Settings
                    </NavLink>
                  </li>
                )}
              </ul>
            </li>
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
