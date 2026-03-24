import styles from "./SectionTitle.module.css";

interface Props {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function SectionTitle({ eyebrow, title, description }: Props) {
  return (
    <div className={styles.wrapper}>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <div className={styles.title}>{title}</div>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  );
}
