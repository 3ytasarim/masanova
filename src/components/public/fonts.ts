import { Playfair_Display } from "next/font/google";

/** Yalnızca public menünün "Lüks" düzeninde kullanılan başlık yazı tipi (self-host, display: swap). */
export const displaySerif = Playfair_Display({ variable: "--font-display-serif", subsets: ["latin", "latin-ext"], display: "swap", weight: ["500", "600"] });
