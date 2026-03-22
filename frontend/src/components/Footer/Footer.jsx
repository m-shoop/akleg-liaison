import styles from "./Footer.module.css";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span>© {year} Alaska Legislative Liaison</span>
        <span className={styles.divider}>·</span>
        <span>34th Legislature</span>
      </div>
    </footer>
  );
}
