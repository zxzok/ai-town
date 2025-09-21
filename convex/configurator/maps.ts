import * as gentle from '../../data/gentle';

export interface MapData {
  width: number;
  height: number;
  tileSetUrl: string;
  tileSetDimX: number;
  tileSetDimY: number;
  tileDim: number;
  bgTiles: typeof gentle.bgtiles;
  objectTiles: typeof gentle.objmap;
  animatedSprites: typeof gentle.animatedsprites;
}

export function getMapData(mapId: string): MapData {
  switch (mapId) {
    case 'default-town':
    case 'gentle':
      return {
        width: gentle.mapwidth,
        height: gentle.mapheight,
        tileSetUrl: gentle.tilesetpath,
        tileSetDimX: gentle.tilesetpxw,
        tileSetDimY: gentle.tilesetpxh,
        tileDim: gentle.tiledim,
        bgTiles: gentle.bgtiles,
        objectTiles: gentle.objmap,
        animatedSprites: gentle.animatedsprites,
      };
    default:
      return {
        width: gentle.mapwidth,
        height: gentle.mapheight,
        tileSetUrl: gentle.tilesetpath,
        tileSetDimX: gentle.tilesetpxw,
        tileSetDimY: gentle.tilesetpxh,
        tileDim: gentle.tiledim,
        bgTiles: gentle.bgtiles,
        objectTiles: gentle.objmap,
        animatedSprites: gentle.animatedsprites,
      };
  }
}
