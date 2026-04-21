/** Zunifikowany rekord przed zapisem do MySQL */
export interface DrawRecord {
  gameName: string;
  drawDate: string; // YYYY-MM-DD
  numbers: number[];
}
