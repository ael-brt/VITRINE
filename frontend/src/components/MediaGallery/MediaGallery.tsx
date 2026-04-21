import styles from "./MediaGallery.module.css";
import { useState } from "react";

interface Props {
  items: {
    type: "image" | "video" | "3d";
    title: string;
    src?: string;
  }[];
}

export function MediaGallery({ items }: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <div className={styles.grid}>
        {items.map((item, idx) => (
          <figure
            key={idx}
            className={`${styles.item} fade-in`}
            onClick={() => item.type !== "video" && item.src && setLightbox(item.src)}
          >
            {item.src && item.type === "video" && (
              <video
                src={item.src}
                controls
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
            {item.src && item.type !== "video" && (
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
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
            padding: 20,
          }}
        >
          <img
            src={lightbox}
            alt="aperçu"
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              borderRadius: 12,
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              background: "#fff",
            }}
          />
        </div>
      )}
    </>
  );
}
