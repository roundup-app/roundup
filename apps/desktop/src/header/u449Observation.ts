export type Box = { height: number; left: number; right: number; top: number; bottom: number };

export type Frame = { top: number; bottom: number; barBottom: number };

export type Observation = {
  case: string; width: number; bar: Box; reserved: Box; title: Box; strip: Box; plus: Box;
  rail: Box; centre: Box; shelf: Box; drawer: Box; close: Box;
  menu: Box | null;
  centreSurfaces: Box[];
  opening?: Frame[]; closing?: Frame[];
  titleText: string; titleName: string; titleTip: string;
  titleTextWidth: number; titlePadding: number;
  titleStyle: { overflow: string; whiteSpace: string };
  controls: { name: string; box: Box; visible: boolean }[];
  scroll: { total: number; width: number };
  checks: Record<string, { status: string }>;
};
