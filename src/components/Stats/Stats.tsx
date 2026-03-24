import styles from "./Stats.module.css";

type Stat = { value: string; label: string };

interface Props {
  stats: Stat[];
}

export function Stats({ stats }: Props) {
  return (
    <div className={styles.grid}>
      {stats.map((stat) => (
        <div key={stat.label} className={styles.tile}>
          <div className={styles.value}>{stat.value}</div>
          <div className={styles.label}>{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
