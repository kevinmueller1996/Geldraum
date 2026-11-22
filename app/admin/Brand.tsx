import Image from "next/image";
import styles from "./brand.module.css";

export function AdminBrand() {
  return <span className={styles.brand} role="img" aria-label="Njora Admin">
    <Image unoptimized src="/njora-mark-small.webp" width="44" height="44" alt="" />
    <Image unoptimized src="/njora-wordmark-small.webp" width="126" height="24" alt="" />
    <small>Admin</small>
  </span>;
}
