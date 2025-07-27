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

### Member methods and variables

Heatmap objects contain numerous member variables and methods; below we highlight only the ones intended for consumption by the user. 

#### Methods

- `.addPolyVertex(x,y)`: `x` and `y` are the bins to add a polygon vertex at.
- `.draw(data)`: `data` is either a dense or sparse packed data object, described above, and can be omitted if `.setData(data)` has been called on this dataset previously. Triggers a redraw of the heatmap, following the parameters previously set.
- `.setData(data)`: `data` is either a dense or sparse packed data object, described above. This method parses this object in preparation for plotting; it is not strictly necessary for the user to call this (see `.draw(data)`), but for large sparse data arrays that need to be traversed once on load, it can be advantageous to call this in the background as soon as possible in situations where the user must make additional choices before `.draw()` is called; that way the traversal is complete by the time `.draw()` is called and doesn't create perceived lag for the user.
- `.zoomX(min, max)` / `.zoomY(min, max)`: programatically zoom to the specified min and max bins for the X or Y axis. User will still have to call `.draw()` to actually render the zoomed view.
- `.zoomout()`: reset the X and Y zooms to their largest extent.

#### Variables

The user is warned that these member variables of the heatmap object are meant to be treated as read-only by the user; see the methods section above for programatically manupulating heatmap objects.

- `current[X|Y]axis[Min|Max]Value`: the bin value of the current [min|max] of the [x|y] axis, as currently displayed.
- `data`: a dense or sparse data object set by `.setData(data)` or `.draw(data)`.