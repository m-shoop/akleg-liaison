import styles from "./Footer.module.css";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span>Site design © Michael Shoop {year}.</span>
        <span> Legislative data sourced from akleg.gov is public domain.</span>
        <span className={styles.divider}>·</span>
        <span>34th Legislature</span>
      </div>
    </footer>
  );
}
