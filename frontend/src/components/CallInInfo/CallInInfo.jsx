import styles from "./CallInInfo.module.css";

export default function CallInInfo() {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Call In Info</summary>
      <ul className={styles.list}>
        <li>
          Juneau:{" "}
          <a href="tel:+19075869085" className={styles.link}>586-9085</a>
        </li>
        <li>
          Anchorage:{" "}
          <a href="tel:+19075639085" className={styles.link}>563-9085</a>
        </li>
        <li>
          Toll-free:{" "}
          <a href="tel:+18445869085" className={styles.link}>844-586-9085</a>
        </li>
      </ul>
      <p className={styles.hint}>
        Tap a number on your phone to dial. On desktop, dialing requires an app like FaceTime or Teams.
      </p>
    </details>
  );
}
