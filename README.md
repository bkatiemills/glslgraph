# GLSL Graph

This package provides some lightweight plotting tools that leverage GLSL shaders for rapid plotting.

## heatmap

Example: [examples/heatmap.html](https://bkatiemills.github.io/glslgraph/examples/heatmap.html)

`heatmap` provides 2D histogram plotting with a number of auxiliary features.

### usage notes

 - Create a new heatmap by providing the ID of a pre-existing div to populate, and an object describing configuration options: `new heatmap("target_div_id", config_object)`. Options are enumerated below.
 - Data for the heatmap can be encoded in a _dense_ or _sparse_ format:
   - _dense format_: 2D array `data` where `data[i][j]` contains the z value for the ijth bin.
   - _sparse format_: object with the following schema:
     ```
     {
        xBins: (integer) number of bins in the horizontal axis,
        yBins: (integer) number of bins in the vertical axis,
        x: (integer array) x[i] == horizontal bin number of the ith nonzero bin,
        y: (integer array) y[i] == vertical bin number of the ith nonzero bin,
        z: (integer array) x[i] == histogram counts in the ith nonzero bin,
     }
     ``` 
 - Plot sizing is determined in decending order of priority:
   - if the config object passed to the constructor has property `width` or `height`, this will be used as the `width` and `height` of the plot area, respectively
   - if the div passed to the constructor has `width` or `height` properties set, these dimensions will contain both the plot and accompanying control sidebar.
   - failing the above, the plot plot control sidebar will fill the screen.
 - Default plot interactions:
   - click and drag to zoom
   - double click to zoom out
   - single click to place polygon vertexes (see `options.polycallback` to do things with these polygons)

### configuration options

The `heatmap` constructor accepts an optional configuration object that supports the following properties:

 - `annotationColor`: (string, default '#FF0000' (red)) hex string like '#123456' describing the color of the annotations (cursors, polygons, zoom box) 
 - `bkgColor`: (string) hex string like '#123456' describing the color of the plot backgrond. Plot background will be transparent if this is omitted.
 - `colorscale`: (string, default 'turbo') colorscale to use; current options are 'turbo' and 'viridis'.
 - `height`: (integer, px) sets the height of the plot area. Overrides all other plot width determining logic.
 - `polycallback`: (function) function to be executed when the polygon drawn on the plot is updated. Will be passed an array of bin coordinates like `[[x_0, y_0], [x_1, y_1], ... , [x_n, y_n]]`.
 - `scale`: (string, `linear` or `log`): sets the vertical scale of the plot to linear or log scale.
 - `textColor`: (string, default '#000000' (black)) hex string like '#123456' describing the color of the axis lines, ticks and labels.
 - `width`: (integer, px) sets the width of the plot area. Overrides all other plot width determining logic.
 - `xAxisTitle`: (string) title for the horizontal axis.
 - `yAxisTitle`: (string) title for the vertical axis.