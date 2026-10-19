import * as echarts from 'echarts/core';
import {LineChart,ScatterChart,CustomChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,MarkLineComponent,MarkAreaComponent} from 'echarts/components';
import {LabelLayout} from 'echarts/features';
import {CanvasRenderer} from 'echarts/renderers';
echarts.use([LineChart,ScatterChart,CustomChart,GridComponent,TooltipComponent,MarkLineComponent,MarkAreaComponent,LabelLayout,CanvasRenderer]);
export {echarts};
