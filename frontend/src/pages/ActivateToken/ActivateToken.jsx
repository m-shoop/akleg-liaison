import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { validateToken } from "../../api/auth";
import styles from "./ActivateToken.module.css";

const STATE = {
  VALIDATING: "validating",
  INVALID: "invalid",   // token not found / bad format
  ERROR: "error",       // unexpected server error
};

export default function ActivateToken() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState(STATE.VALIDATING);
  const called = useRef(false);

  const token = searchParams.get("token");
  const type  = searchParams.get("type"); // "registration" | "password_reset"

  useEffect(() => {
    if (!token || !type) {
      setState(STATE.INVALID);
      return;
    }

    // Ref persists across StrictMode remounts; prevents double-consuming the token
    if (called.current) return;
    called.current = true;

    validateToken(token, type)
      .then(() => navigate("/set-password", { replace: true }))
      .catch((err) => {
        if (err.message === "token_expired") {
          // Redirect to login with a banner indicating which workflow expired
          const tokenType = err.tokenType ?? type;
          navigate(`/login?tokenExpired=${tokenType}`, { replace: true });
        } else {
          // Invalid / already-used token
          setState(STATE.INVALID);
        }
      });
  }, []); // run once on mount

  if (state === STATE.VALIDATING) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.loadingMsg}>Verifying your link…</p>
        </div>
      </div>
    );
  }

  // INVALID state
  const workflowLabel = type === "password_reset" ? "password reset" : "registration";
  const workflowPath  = type === "password_reset" ? "/forgot-password" : "/register";

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Link no longer valid</h1>
        <p className={styles.msg}>
          This link is no longer valid. It may have already been used or never
          existed.
        </p>
        <p className={styles.msg}>
          Please{" "}
          <Link to={workflowPath} className={styles.link}>
            request a new {workflowLabel} link
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
