/**Layer definition.

 TODO: split into several files?
 */
import React, {Component} from 'react';
import {connect} from 'react-redux';
import Select from 'react-select'
import Accordion from 'react-bootstrap/Accordion';
import Card from 'react-bootstrap/Card';
import {Button, Form} from 'react-bootstrap';
import {CypherEditor} from "graph-app-kit/components/Editor"
import {confirmAlert} from 'react-confirm-alert'; // Import
import neo4jService from '../../services/neo4jService'
import {addOrUpdateLayer, removeLayer} from "../../actions";


import 'react-confirm-alert/src/react-confirm-alert.css'; // Import css
// css needed for CypherEditor
import "codemirror/lib/codemirror.css";
import "codemirror/addon/lint/lint.css";
import "codemirror/addon/hint/show-hint.css";
import "cypher-codemirror/dist/cypher-codemirror-syntax.css";
import ColorPicker from "../ColorPicker";


// layer type: either from node labels or cypher
const LAYER_TYPE_LATLON = "latlon";
const LAYER_TYPE_POINT = "point";
const LAYER_TYPE_CYPHER = "cypher";
const LAYER_TYPE_SPATIAL = "spatial";

// TODO: move this into a separate configuration/constants file
export const RENDERING_MARKERS = "markers";
export const RENDERING_POLYLINE = "polyline";
export const RENDERING_RELATIONS = "relations";
export const RENDERING_HEATMAP = "heatmap";
export const RENDERING_CLUSTERS = "clusters";


// default parameters for new layers
const DEFAULT_LAYER = {
	name: "New layer",
	layerType: LAYER_TYPE_LATLON,
	latitudeProperty: {value: "latitude", label: "latitude"},
	longitudeProperty: {value: "longitude", label: "longitude"},
	pointProperty: {value: "point", label: "point"},
	tooltipProperty: {value: "", label: ""},
	relationshipTooltipProperty: {value: "", label: ""},
	nodeLabel: [],
	relationshipLabel: [],
	propertyNames: [],
	spatialLayers: [],
	data: [],
	relationshipData: [],
	relationships: [],
	bounds: [],
	color: {r: 0, g: 0, b: 255, a: 1},
	relationshipColor: {r: 0, g: 0, b: 255, a: 1},
	limit: null,
	rendering: RENDERING_MARKERS,
	radius: 30,
	cypher: "",
	// TODO: this should not be in Layer state?
	hasSpatialPlugin: false,
	spatialLayer: {value: "", label: ""},
};


export class UnconnectedLayer extends Component {

	constructor(props) {
		super(props);

		if (props.layer !== undefined) {
			this.state = props.layer;
		} else {
			this.state = DEFAULT_LAYER;
			this.state["ukey"] = props.ukey;
		}

		this.driver = props.driver;

		this.sendData = this.sendData.bind(this);
		this.deleteLayer = this.deleteLayer.bind(this);
		this.showQuery = this.showQuery.bind(this);
		this.handleNameChange = this.handleNameChange.bind(this);
		this.handleLayerTypeChange = this.handleLayerTypeChange.bind(this);
		this.handleNodeLabelChange = this.handleNodeLabelChange.bind(this);
		this.handleRelationshipLabelChange = this.handleRelationshipLabelChange.bind(this);
		this.handleLatPropertyChange = this.handleLatPropertyChange.bind(this);
		this.handleLonPropertyChange = this.handleLonPropertyChange.bind(this);
		this.handlePointPropertyChange = this.handlePointPropertyChange.bind(this);
		this.handleTooltipPropertyChange = this.handleTooltipPropertyChange.bind(this);
		this.handleRelationshipTooltipPropertyChange = this.handleRelationshipTooltipPropertyChange.bind(this);
		this.handleLimitChange = this.handleLimitChange.bind(this);
		this.handleColorChange = this.handleColorChange.bind(this);
		this.handleRelationshipColorChange = this.handleRelationshipColorChange.bind(this);
		this.handleRenderingChange = this.handleRenderingChange.bind(this);
		this.handleRadiusChange = this.handleRadiusChange.bind(this);
		this.handleCypherChange = this.handleCypherChange.bind(this);
		this.handleSpatialLayerChanged = this.handleSpatialLayerChanged.bind(this);

	};


	componentDidMount () {
		// list of available nodes
		this.getNodeLabels();
		this.getRelationshipLabels();
		this.getPropertyNames();
		this.hasSpatialPlugin();
		this.getSpatialLayers();
	}


	updateBounds() {
		/* Compute the map bounds based on `this.state.data`
         */
		let arr = this.state.data;
		// TODO: delegate this job to leaflet
		let minLat = Number.MAX_VALUE;
		let maxLat = -Number.MAX_VALUE;
		let minLon = Number.MAX_VALUE;
		let maxLon = -Number.MAX_VALUE;
		if (arr.length > 0) {
			arr.map((item,) => {
				let lat = item.pos[0];
				let lon = item.pos[1];
				if (lat > maxLat) {
					maxLat = lat;
				}
				if (lat < minLat) {
					minLat = lat;
				}
				if (lon > maxLon) {
					maxLon = lon;
				}
				if (lon < minLon) {
					minLon = lon;
				}
				return undefined;
			});
		}
		let bounds = [[minLat, minLon], [maxLat, maxLon]];
		this.setState({bounds: bounds}, function () {
			this.props.dispatch(
				addOrUpdateLayer({layer: this.state})
			);
		});
	};


	getCypherQuery() {
		// TODO: check that the query is valid
		return this.state.cypher;
	};


	getNodeFilter() {
		let filter = '';
		// filter wanted node labels
		if (this.state.nodeLabel !== null && this.state.nodeLabel.length > 0) {
			let sub_q = "(false";
			this.state.nodeLabel.forEach((value,) => {
				let lab = value.label;
				// added backtics to support labels with spaces
				sub_q += ` OR n:\`${lab}\``;
			});
			sub_q += ")";
			filter += "\nAND " + sub_q;
		}
		return filter;
	};

	getRelationshipsFilter() {
		let filter = '';
		// filter wanted node labels
		const {nodeLabel, relationshipLabel} = this.state;
		if (nodeLabel != null && nodeLabel.length > 0) {
			let sub_q = "(false";
			nodeLabel.forEach(value => {
				// added backtics to support labels with spaces
				sub_q += ` OR (n:\`${value.label}\` and m:\`${value.label}\`)`;
			});
			sub_q += ")";
			filter += "\nAND " + sub_q;
		}
		if (relationshipLabel != null && relationshipLabel.length > 0) {
			let sub_q = "(false";
			relationshipLabel.forEach(value => {
				sub_q += ` OR r:\`${value.label}\``;
			});
			sub_q += ")";
			filter += "\nAND " + sub_q;
		}
		return filter;
	};


	getSpatialQuery() {
		let query = `CALL spatial.layer('${this.state.spatialLayer.value}') YIELD node `;
		query += "WITH node ";
		query += "MATCH (node)-[:RTREE_ROOT]-()-[:RTREE_CHILD*1..10]->()-[:RTREE_REFERENCE]-(n) ";
		query += "WHERE n.point.srid = 4326 ";
		query += "RETURN n.point.x as longitude, n.point.y as latitude ";
		if (this.state.tooltipProperty.value !== '')
			query += `, n.${this.state.tooltipProperty.value} as tooltip `;
		if (this.state.limit)
			query += `\nLIMIT ${this.state.limit}`;
		return query;
	};

	getNodesQuery() {
		const { layerType, limit } = this.state;
		const { value: latValue } = this.state.latitudeProperty;
		const { value: lonValue } = this.state.longitudeProperty;
		const { value: pointValue } = this.state.pointProperty;
		const { value: tooltipValue } = this.state.tooltipProperty;
		// lat lon query
		// TODO: improve this method...
		let query = 'MATCH (n) WHERE true';
		// filter wanted node labels
		query += this.getNodeFilter();
		// filter out nodes with null latitude or longitude
		if (layerType === LAYER_TYPE_LATLON) {
			query += `\nAND exists(n.${latValue}) AND exists(n.${lonValue})`;
			// return latitude, longitude
			query += `\nRETURN n.${latValue} as latitude, n.${lonValue} as longitude`;
		} else if (layerType === LAYER_TYPE_POINT) {
			query += `\nAND exists(n.${pointValue})`;
			// return latitude, longitude
			query += `\nRETURN n.${pointValue}.y as latitude, n.${pointValue}.x as longitude`;
		}

		// if tooltip is not null, also return tooltip
		if (tooltipValue !== '')
			query += `, n.${tooltipValue} as tooltip`;

		// TODO: is that really needed???
		// limit the number of points to avoid browser crash...
		if (limit)
			query += `\nLIMIT ${limit}`;
		console.log(query)
		return query;
	}


	getQuery() {
		/*If layerType==cypher, query is inside the CypherEditor,
           otherwise, we need to build the query manually.
         */
		const { layerType } = this.state;
		if (layerType === LAYER_TYPE_CYPHER)
			return this.getCypherQuery();

		if (layerType === LAYER_TYPE_SPATIAL)
			return this.getSpatialQuery();
		return this.getNodesQuery();		
	};

	getRelationshipTypes() {
		const query = "CALL db.relationshipTypes()"
	}

	getRelationshipsQuery() {
		// SUPPORTS ONLY LAT LON FOR NOW
		const { value: latValue } = this.state.latitudeProperty;
		const { value: lonValue } = this.state.longitudeProperty;
		const { value: tooltipValue } = this.state.relationshipTooltipProperty;
		const { limit } = this.state;
		// lat lon query
		// TODO: improve this method...
		let query = 'MATCH (n)-[r]->(m) WHERE true';
		// filter wanted node labels
		query += this.getRelationshipsFilter();
		
		// filter out nodes with null latitude or longitude
		query += `\nAND exists(n.${latValue}) AND exists(n.${lonValue}) AND exists(m.${latValue}) AND exists(m.${lonValue})`;
		// return latitude, longitude
		query += `\nRETURN n.${latValue} as start_latitude, n.${lonValue} as start_longitude, m.${latValue} as end_latitude, m.${lonValue} as end_longitude`;

		// if tooltip is not null, also return tooltip
		if (tooltipValue !== '')
			query += `, n.${tooltipValue} as tooltip`;

		// TODO: is that really needed???
		// limit the number of points to avoid browser crash...
		if (limit)
			query += `\nLIMIT ${limit}`;
		console.log(query)
		return query;
	}


	updateData() {
		/*Query database and update `this.state.data`
         */
		const { rendering } = this.state;
		neo4jService.getData(this.driver, this.getQuery(), {}).then( res => {
			if (res.status === "ERROR") {
				let message = "Invalid cypher query.";
				if (this.state.layerType !== LAYER_TYPE_CYPHER) {
					message += "\nContact the development team";
				} else {
					message += "\nFix your query and try again";
				}
				message += "\n\n" + res.result;
				alert(message);
			} else {
				this.setState({data: res.result}, () => {if (rendering !== RENDERING_RELATIONS) {this.updateBounds()}});
			}
		});
		if (rendering === RENDERING_RELATIONS) {
			neo4jService.getRelationshipData(this.driver, this.getRelationshipsQuery(), {}).then( res => {
				if (res.status === "ERROR") {
					let message = "Invalid cypher query.";
					if (this.state.layerType !== LAYER_TYPE_CYPHER) {
						message += "\nContact the development team";
					} else {
						message += "\nFix your query and try again";
					}
					message += "\n\n" + res.result;
					alert(message);
				} else {
					this.setState({relationshipData: res.result}, this.updateBounds);
				}
			});
		}
	};


	handleNameChange(e) {
		this.setState({name: e.target.value});
	};


	handleLimitChange(e) {
		this.setState({limit: e.target.value});
	};


	handleLayerTypeChange(e) {
		let old_type = this.state.layerType;
		let new_type = e.target.value;
		if (old_type === new_type) {
			return;
		}
		if (new_type === LAYER_TYPE_CYPHER) {
			this.setState({cypher: this.getQuery()});
		} else if (old_type === LAYER_TYPE_CYPHER) {
			if (
				window.confirm(
					'You will lose your cypher query, is that what you want?'
				) === false
			) {
				return;
			}
			this.setState({cypher: ""});
		}
		this.setState({layerType: e.target.value});
	};


	handleLatPropertyChange(e) {
		this.setState({latitudeProperty: e});
	};


	handleLonPropertyChange(e) {
		this.setState({longitudeProperty: e});
	};


	handlePointPropertyChange(e) {
		this.setState({pointProperty: e});
	};


	handleTooltipPropertyChange(e) {
		this.setState({tooltipProperty: e});
	};

	handleRelationshipTooltipPropertyChange(e) {
		this.setState({relationshipTooltipProperty: e});
	};


	handleNodeLabelChange(e) {
		this.setState({nodeLabel: e}, function() {
			this.getPropertyNames();
		});
	};

	handleRelationshipLabelChange(e) {
		this.setState({relationshipLabel: e});
	};


	handleColorChange(color) {
		this.setState({
			color: color,
		});
	};

	handleRelationshipColorChange(color) {
		this.setState({
			relationshipColor: color,
		});
	};


	handleSpatialLayerChanged(e) {
		this.setState({
			spatialLayer: e,
		});
	};


	handleRenderingChange(e) {
		this.setState({rendering: e.target.value});
	};


	handleRadiusChange(e) {
		this.setState({radius: parseFloat(e.target.value)});
	};


	handleCypherChange(e) {
		this.setState({cypher: e});
	};


	sendData(event) {
		/*Send data to parent which will propagate to the Map component
         */
		this.updateData();
		event.preventDefault();
	};


	deleteLayer(event) {
		/*Remove the layer
         */
		event.preventDefault();
		if (
			window.confirm(
				`Delete layer ${this.state.name}? This action can not be undone.`
			) === false
		) {
			return;
		}
		this.props.dispatch(
			removeLayer({ukey: this.state.ukey})
		);
	};


	showQuery(event) {
		confirmAlert({
			message: this.getQuery(),
			buttons: [
				{
					label: 'OK',
				}
			]
		});
		event.preventDefault();
	};


	hasSpatialPlugin() {
		neo4jService.hasSpatial(this.driver).then(result => {
			this.setState({
				hasSpatialPlugin: result
			});
		});
	};


	getNodeLabels() {
		/*This will be updated quite often,
           is that what we want?
         */
		neo4jService.getNodeLabels(this.driver).then( result => {
			this.setState({
				nodes: result
			})
		});
	};

	getRelationshipLabels() {  
		neo4jService.getRelationshipLabels(this.driver).then( result => {
			this.setState({
				relationships: result
			})
		});
	};


	getPropertyNames() {
		neo4jService.getProperties(this.driver, this.getNodeFilter()).then( result => {
			result.push({value: "", label: ""}); // This is the default: no tooltip
			this.setState({propertyNames: result});
		});
	};


	getSpatialLayers() {
		neo4jService.getSpatialLayers(this.driver).then(result => {
			this.setState({spatialLayers: result});
		});
	};


	renderConfigSpatial() {
		if (this.state.layerType !== LAYER_TYPE_SPATIAL)
			return "";

		return (
			<div>
				<Form.Group controlId="formSpatialLayer">
					<Form.Label>Spatial layer</Form.Label>
					<Select
						className="form-control select"
						options={this.state.spatialLayers}
						onChange={this.handleSpatialLayerChanged}
						isMulti={false}
						defaultValue={this.state.spatialLayer}
						name="nodeLabel"
					/>
				</Form.Group>
				<Form.Group 
					controlId="formTooltipProperty" 
					hidden={this.state.rendering !== RENDERING_MARKERS && this.state.rendering !== RENDERING_CLUSTERS}  
					name="formgroupTooltip"
				>
					<Form.Label>Tooltip property</Form.Label>
					<Select
						className="form-control select"
						options={this.state.propertyNames}
						onChange={this.handleTooltipPropertyChange}
						isMulti={false}
						defaultValue={this.state.tooltipProperty.value}
						name="tooltipProperty"
					/>
				</Form.Group>
			</div>
		)
	};


	renderConfigCypher() {
		/*If layerType==cypher, then we display the CypherEditor
         */
		if (this.state.layerType !== LAYER_TYPE_CYPHER)
			return "";
		return (
			<Form.Group controlId="formCypher">
				<Form.Label>Query</Form.Label>
				<Form.Text>
					<p>Checkout <a href="https://github.com/stellasia/neomap/wiki" target="_blank" rel="noopener noreferrer" >the documentation</a> (Ctrl+SPACE for autocomplete)</p>
					<p className="font-italic">Be careful, the browser can only display a limited number of nodes (less than a few 10000)</p>
				</Form.Text>
				<CypherEditor
					value={this.state.cypher}
					onValueChange={this.handleCypherChange}
					name="cypher"
				/>
			</Form.Group>
		)
	};


	renderConfigPoint() {
		if (this.state.layerType !== LAYER_TYPE_POINT)
			return "";
		return (
			<div>
				<Form.Group controlId="formNodeLabel">
					<Form.Label>Node label(s)</Form.Label>
					<Select
						className="form-control select"
						options={this.state.nodes}
						onChange={this.handleNodeLabelChange}
						isMulti={true}
						defaultValue={this.state.nodeLabel}
						name="nodeLabel"
					/>
				</Form.Group>

				<Form.Group controlId="formPointProperty">
					<Form.Label>Point property</Form.Label>
					<Select
						className="form-control select"
						options={this.state.propertyNames}
						onChange={this.handlePointPropertyChange}
						isMulti={false}
						defaultValue={this.state.pointProperty}
						name="pointProperty"
					/>
				</Form.Group>

				<Form.Group
					controlId="formTooltipProperty"
					hidden={this.state.rendering !== RENDERING_MARKERS && this.state.rendering !== RENDERING_CLUSTERS}
					name="formgroupTooltip"
				>
					<Form.Label>Tooltip property</Form.Label>
					<Select
						className="form-control select"
						options={this.state.propertyNames}
						onChange={this.handleTooltipPropertyChange}
						isMulti={false}
						defaultValue={this.state.tooltipProperty}
						name="tooltipProperty"
					/>
				</Form.Group>

				<Form.Group controlId="formLimit">
					<Form.Label>Max. nodes</Form.Label>
					<Form.Control
						type="text"
						className="form-control"
						placeholder="limit"
						defaultValue={this.state.limit}
						onChange={this.handleLimitChange}
						name="limit"
					/>
				</Form.Group>
			</div>
		)
	}

  
	renderConfigDefault() {
		/*If layerType==latlon, then we display the elements to choose
           node labels and properties to be used.
         */
		const { rendering, layerType, nodes, nodeLabel, relationships, relationshipLabel,
			propertyNames, latitudeProperty, longitudeProperty, tooltipProperty, relationshipTooltipProperty,
			limit
		} = this.state;
		if (layerType !== LAYER_TYPE_LATLON)
			return "";
		return (
			<div>
				<Form.Group controlId="formNodeLabel">
					<Form.Label>Node label(s)</Form.Label>
					<Select
						className="form-control select"
						options={nodes}
						onChange={this.handleNodeLabelChange}
						isMulti={true}
						defaultValue={nodeLabel}
						name="nodeLabel"
					/>
				</Form.Group>
				{/* TODO MOVE */}
				<Form.Group controlId="formRelationshipLabel" hidden={rendering !== RENDERING_RELATIONS }>
					<Form.Label>Relationship label(s)</Form.Label>
					<Select
						className="form-control select"
						options={relationships}
						onChange={this.handleRelationshipLabelChange}
						isMulti={true}
						defaultValue={relationshipLabel}
						name="relationshipLabel"
					/>
				</Form.Group>
				<Form.Group controlId="formLatitudeProperty">
					<Form.Label>Latitude property</Form.Label>
					<Select
						className="form-control select"
						options={propertyNames}
						onChange={this.handleLatPropertyChange}
						isMulti={false}
						defaultValue={latitudeProperty}
						name="latitudeProperty"
					/>
				</Form.Group>

				<Form.Group controlId="formLongitudeProperty">
					<Form.Label>Longitude property</Form.Label>
					<Select
						className="form-control select"
						options={propertyNames}
						onChange={this.handleLonPropertyChange}
						isMulti={false}
						defaultValue={longitudeProperty}
						name="longitudeProperty"
					/>
				</Form.Group>

				<Form.Group 
					controlId="formTooltipProperty" 
					hidden={rendering !== RENDERING_MARKERS  && rendering !== RENDERING_CLUSTERS && rendering !== RENDERING_RELATIONS}  
					name="formgroupTooltip"
				>
					<Form.Label>Tooltip property</Form.Label>
					<Select
						className="form-control select"
						options={propertyNames}
						onChange={this.handleTooltipPropertyChange}
						isMulti={false}
						defaultValue={tooltipProperty}
						name="tooltipProperty"
					/>
				</Form.Group>

				<Form.Group 
					controlId="formRelationshipTooltipProperty" 
					hidden={true}  // TODO figure out how to display tooltip at polyline
					name="formgroupRelationshipTooltip"
				>
					<Form.Label>Relationship Tooltip property</Form.Label>
					<Select
						className="form-control select"
						options={propertyNames}
						onChange={this.handleRelationshipTooltipPropertyChange}
						isMulti={false}
						defaultValue={relationshipTooltipProperty}
						name="relationshipTooltipProperty"
					/>
				</Form.Group>

				<Form.Group controlId="formLimit">
					<Form.Label>Max. nodes</Form.Label>
					<Form.Control
						type="text"
						className="form-control"
						placeholder="limit"
						defaultValue={limit}
						onChange={this.handleLimitChange}
						name="limit"
					/>
				</Form.Group>
			</div>
		)
	};


	render() {
		const { name, ukey, rendering, layerType, hasSpatialPlugin, color, relationshipColor,
			radius,
		} = this.state;
		const colorString = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
		return (

			<Card>

				<Accordion.Toggle as={Card.Header} eventKey={ukey} >
					<h3>{name}
						<small hidden>({ukey})</small>
						<span
							hidden={ rendering === RENDERING_HEATMAP }
							style={{background: colorString, float: 'right', height: '20px', width: '50px'}}> 
						</span>
					</h3>
				</Accordion.Toggle>

				<Accordion.Collapse eventKey={ukey} >

					<Card.Body>

						<Form action="" >

							<Form.Group controlId="formLayerName">
								<Form.Label>Name</Form.Label>
								<Form.Control
									type="text"
									className="form-control"
									placeholder="Layer name"
									defaultValue={name}
									onChange={this.handleNameChange}
									name="name"
								/>
							</Form.Group>


							<h4>  > Data</h4>

							<Form.Group controlId="formLayerType">
								<Form.Label>Layer type</Form.Label>
								<Form.Check
									type="radio"
									id={LAYER_TYPE_LATLON}
									label={"Lat/Lon"}
									value={LAYER_TYPE_LATLON}
									checked={layerType === LAYER_TYPE_LATLON}
									onChange={this.handleLayerTypeChange}
									name="layerTypeLatLon"
								/>
								<Form.Check
									type="radio"
									id={LAYER_TYPE_POINT}
									label={"Point (neo4j built-in)"}
									value={LAYER_TYPE_POINT}
									checked={layerType === LAYER_TYPE_POINT}
									onChange={this.handleLayerTypeChange}
									name="layerTypePoint"
								/>
								<Form.Check
									type="radio"
									id={LAYER_TYPE_SPATIAL}
									label={"Point (neo4j-spatial plugin)"}
									value={LAYER_TYPE_SPATIAL}
									checked={layerType === LAYER_TYPE_SPATIAL}
									onChange={this.handleLayerTypeChange}
									name="layerTypeSpatial"
									disabled={!hasSpatialPlugin}
									className="beta"
								/>
								<Form.Check
									type="radio"
									id={LAYER_TYPE_CYPHER}
									label={"Advanced (cypher query)"}
									value={LAYER_TYPE_CYPHER}
									checked={layerType === LAYER_TYPE_CYPHER}
									onChange={this.handleLayerTypeChange}
									name="layerTypeCypher"
								/>
							</Form.Group>

							{this.renderConfigDefault()}
							{this.renderConfigPoint()}
							{this.renderConfigCypher()}
							{this.renderConfigSpatial()}

							<h4> > Map rendering</h4>

							<Form.Group controlId="formRendering">
								<Form.Label>Rendering</Form.Label>
								<Form.Check
									type="radio"
									id={RENDERING_MARKERS}
									label={"Markers"}
									value={RENDERING_MARKERS}
									checked={rendering === RENDERING_MARKERS}
									onChange={this.handleRenderingChange}
									name="mapRenderingMarker"
								/>
								<Form.Check
									type="radio"
									id={RENDERING_POLYLINE}
									label={"Polyline"}
									value={RENDERING_POLYLINE}
									checked={rendering === RENDERING_POLYLINE}
									onChange={this.handleRenderingChange}
									name="mapRenderingPolyline"
								/>
								<Form.Check
									type="radio"
									id={RENDERING_RELATIONS}
									label={"Nodes and Relationships"}
									value={RENDERING_RELATIONS}
									checked={rendering === RENDERING_RELATIONS}
									onChange={this.handleRenderingChange}
									name="mapRenderingRelationships"
								/>
								<Form.Check
									type="radio"
									id={RENDERING_HEATMAP}
									label={"Heatmap"}
									value={RENDERING_HEATMAP}
									checked={rendering === RENDERING_HEATMAP}
									onChange={this.handleRenderingChange}
									name="mapRenderingHeatmap"
									className="beta"
								/>
								<Form.Check
									type="radio"
									id={RENDERING_CLUSTERS}
									label={"Clusters"}
									value={RENDERING_CLUSTERS}
									checked={rendering === RENDERING_CLUSTERS}
									onChange={this.handleRenderingChange}
									name="mapRenderingCluster"
									className="beta"
								/>
							</Form.Group>

							<Form.Group controlId="formColor"
										hidden={rendering === RENDERING_HEATMAP}
										name="formgroupColor">
								<Form.Label>Color</Form.Label>
								<ColorPicker
									color={ color }
									handleColorChange={this.handleColorChange}
								/>
							</Form.Group>

							<Form.Group controlId="formRelationshipColor"
										hidden={rendering !== RENDERING_RELATIONS}
										name="formgroupRelationshipColor">
								<Form.Label>Relationship Color</Form.Label>
								<ColorPicker
									color={ relationshipColor }
									handleColorChange={this.handleRelationshipColorChange}
								/>
							</Form.Group>

							<Form.Group controlId="formRadius" hidden={rendering !== RENDERING_HEATMAP} >
								<Form.Label>Heatmap radius</Form.Label>
								<Form.Control
									type="range"
									min="1"
									max="100"
									defaultValue={radius}
									className="slider"
									onChange={this.handleRadiusChange}
									name="radius"
								/>
							</Form.Group>


							<Button variant="danger" type="submit"  onClick={this.deleteLayer} hidden={this.props.layer === undefined}>
								Delete Layer
							</Button>

							<Button variant="info" type="submit"  onClick={this.showQuery} hidden={layerType === LAYER_TYPE_CYPHER}>
								Show query
							</Button>

							<Button variant="success" type="submit"  onClick={this.sendData} >
								Update map
							</Button>

						</Form>
					</Card.Body>

				</Accordion.Collapse>

			</Card>

		);
	}
}

export default connect()(UnconnectedLayer);
