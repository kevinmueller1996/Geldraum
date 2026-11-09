import styles from "./brand.module.css";

export function AdminBrand() {
  return <span className={styles.brand} role="img" aria-label="Njora Admin">
    <img src="/njora-mark.png" width="44" height="44" alt="" />
    <img src="/njora-wordmark.png" width="126" height="24" alt="" />
    <small>Admin</small>
  </span>;
}
