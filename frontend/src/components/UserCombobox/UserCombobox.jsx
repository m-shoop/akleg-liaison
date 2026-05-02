import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { searchUsers } from "../../api/users";
import styles from "./UserCombobox.module.css";

export default function UserCombobox({
  value,
  onChange,
  token,
  placeholder = "email…",
  autoFocus = false,
  inputClassName,
}) {
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const timerRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  function positionDropdown() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 3,
        left: rect.left,
        width: rect.width,
      });
    }
  }

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!value?.trim()) {
      setOptions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchUsers(value, token);
        setOptions(results);
        if (results.length > 0) {
          positionDropdown();
          setOpen(true);
        } else {
          setOpen(false);
        }
      } catch {
        setOptions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timerRef.current);
  }, [value, token]);

  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className={`${styles.input} ${inputClassName ?? ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (options.length > 0) {
            positionDropdown();
            setOpen(true);
          }
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {loading && <span className={styles.spinner}>…</span>}
      {open &&
        options.length > 0 &&
        createPortal(
          <ul className={styles.dropdown} style={dropdownStyle}>
            {options.map((email) => (
              <li
                key={email}
                className={styles.option}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(email);
                  setOpen(false);
                }}
              >
                {email}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
