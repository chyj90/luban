// LubanUI 入口 — 构建注入 iframe 的 CSS / JS 字符串
import themeCSS from './theme.css?raw';
import tableCSS from './components/table.css?raw';
import buttonCSS from './components/button.css?raw';
import formCSS from './components/form.css?raw';
import inputCSS from './components/input.css?raw';
import textareaCSS from './components/textarea.css?raw';
import selectCSS from './components/select.css?raw';
import inputNumberCSS from './components/input-number.css?raw';
import datepickerCSS from './components/datepicker.css?raw';
import checkboxCSS from './components/checkbox.css?raw';
import radioCSS from './components/radio.css?raw';
import switchCSS from './components/switch.css?raw';
import statsCSS from './components/stats.css?raw';
import cardCSS from './components/card.css?raw';
import modalCSS from './components/modal.css?raw';
import paginationCSS from './components/pagination.css?raw';
import tabsCSS from './components/tabs.css?raw';
import badgeCSS from './components/badge.css?raw';
import chartCSS from './components/chart.css?raw';
import topologyCSS from './components/topology.css?raw';
import mapCSS from './components/map.css?raw';
import filterBarCSS from './components/filter-bar.css?raw';
import toastCSS from './components/toast.css?raw';
import emptyCSS from './components/empty.css?raw';
import loadingCSS from './components/loading.css?raw';
import pageHeaderCSS from './components/page-header.css?raw';
import showcaseCSS from './showcase.css?raw';

import tableJS from './components/table.js?raw';
import modalJS from './components/modal.js?raw';
import toastJS from './components/toast.js?raw';
import selectJS from './components/select.js?raw';
import pageHeaderJS from './components/page-header.js?raw';
import lubanUIJS from './LubanUI.js?raw';

import echartsSource from 'echarts/dist/echarts.min.js?raw';
import echartsGLSource from 'echarts-gl/dist/echarts-gl.min.js?raw';
import leafletSource from 'leaflet/dist/leaflet.js?raw';
import leafletCSSRaw from 'leaflet/dist/leaflet.css?raw';

export const LUBAN_UI_CSS = [
  themeCSS,
  tableCSS,
  buttonCSS,
  formCSS,
  inputCSS,
  textareaCSS,
  selectCSS,
  inputNumberCSS,
  datepickerCSS,
  checkboxCSS,
  radioCSS,
  switchCSS,
  statsCSS,
  cardCSS,
  modalCSS,
  paginationCSS,
  tabsCSS,
  badgeCSS,
  chartCSS,
  topologyCSS,
  mapCSS,
  filterBarCSS,
  toastCSS,
  emptyCSS,
  loadingCSS,
  pageHeaderCSS,
  showcaseCSS,
  leafletCSSRaw,
].join('\n');

export const LUBAN_UI_JS = [
  tableJS,
  modalJS,
  toastJS,
  selectJS,
  pageHeaderJS,
  lubanUIJS,
  // GIS 地图底座（LubanUI.gis 依赖全局 L；打包内置，禁止 CDN 引入）
  leafletSource,
].join('\n');

export const ECHARTS_SOURCE = echartsSource;
export const ECHARTS_GL_SOURCE = echartsGLSource;
export const LEAFLET_SOURCE = leafletSource;
export const LEAFLET_CSS = leafletCSSRaw;