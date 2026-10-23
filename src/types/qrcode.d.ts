declare module "qrcode" {
  interface QrModules {
    size: number;
    data: ArrayLike<number>;
  }
  export function create(
    text: string,
    opts?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
  ): { modules: QrModules };
}
