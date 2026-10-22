import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

export const cesiumStore = defineStore('cesiumStore', {
  //定义数据
  state: () => {
    return {
      viewer: null,
      tilesets: null,
      lines: [], // 线路数据：由 left1.vue 请求 /getLine 后写入仓库
    };
  },

  //获得数据
  getters: {
    Viewer() {
      return this.viewer;
    },
    Tilesets() {
      return this.tilesets;
    },
    Lines() {
      return this.lines;
    },
  },

  //改数据（存入/修改）
  actions: {
    setViewer(viewer) {
      return new Promise((resolve, reject) => {
        this.viewer = viewer;
        resolve(viewer); //这里主要是把传入的viewer变成仓库属性 return 回去 viewer无用
      });
    },
    setTilesets(tilesets) {
      return new Promise((resolve, reject) => {
        this.tilesets = tilesets;
        resolve(tilesets);
      });
    },
    setLines(lines) {
      return new Promise((resolve, reject) => {
        this.lines = lines;
        resolve(lines);
      });
    },
  },
});
