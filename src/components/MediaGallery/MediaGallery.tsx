import styles from "./MediaGallery.module.css";

interface Props {
  items: {
    type: "image" | "video" | "3d";
    title: string;
    src?: string;
  }[];
}

export function MediaGallery({ items }: Props) {
  return (
    <div className={styles.grid}>
      {items.map((item, idx) => (
        <figure key={idx} className={`${styles.item} fade-in`}>
          {item.src && (
            <img
              src={item.src}
              alt={item.title}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          {!item.src && <div>{item.title}</div>}
          <figcaption className={styles.label}>{item.type.toUpperCase()}</figcaption>
        </figure>
      ))}
    </div>
  );
}
