//
// Habitat Attribution module for BNG (Biodiversity Net Gain) baseline data
// Handles parcel selection, form rendering, and validation for Area Habitat attribution
//

(function(window) {
  'use strict';

  // Broad Habitat to Habitat Type mapping (Area Module Only)
  const HABITAT_TYPES = {
    "Cropland": [
      "Arable",
      "Arable field margins cultivated annually",
      "Arable field margins game bird mix",
      "Arable field margins pollen and nectar",
      "Arable field margins tussocky"
    ],
    "Grassland": [
      "Other neutral grassland",
      "Lowland calcareous grassland",
      "Lowland dry acid grassland",
      "Other lowland acid grassland",
      "Upland acid grassland",
      "Modified grassland",
      "Floodplain wetland mosaic and coastal and floodplain grazing marsh",
      "Traditional orchard"
    ],
    "Heathland and shrub": [
      "Lowland heathland",
      "Upland heathland",
      "Mountain heathland",
      "Blackthorn scrub",
      "Bramble scrub",
      "Gorse scrub",
      "Hawthorn scrub",
      "Hazel scrub",
      "Willow scrub",
      "Mixed scrub"
    ],
    "Woodland and forest": [
      "Lowland mixed deciduous woodland",
      "Lowland beech and yew woodland",
      "Wet woodland",
      "Upland oakwood",
      "Upland mixed ashwoods",
      "Other woodland; broadleaved",
      "Other woodland; mixed",
      "Other coniferous woodland",
      "Wood-pasture and parkland",
      "Felled"
    ],
    "Lakes": [
      "Ponds (priority habitat)",
      "Ponds (non-priority habitat)",
      "Lakes",
      "Reservoirs"
    ],
    "Sparsely vegetated land": [
      "Bare ground",
      "Other inland rock and scree"
    ],
    "Urban": [
      "Developed land; sealed surface",
      "Developed land; unsealed surface",
      "Vegetated garden",
      "Unvegetated garden",
      "Cemeteries and churchyards",
      "Allotments",
      "Open mosaic habitat on previously developed land",
      "Public open space",
      "Sustainable drainage systems",
      "Biodiverse green roof",
      "Other green roof",
      "Green wall"
    ],
    "Individual trees": [
      "Individual tree - urban",
      "Individual tree - rural"
    ],
    "Intertidal sediment": [
      "Littoral coarse sediment",
      "Littoral sand",
      "Littoral mud"
    ],
    "Intertidal hard structures": [
      "Artificial hard structures",
      "Artificial hard structures with integrated greening of grey infrastructure (IGGI)"
    ]
  };

  // Distinctiveness bands for each habitat type
  // Values: Very Low, Low, Medium, High, Very High
  const DISTINCTIVENESS_MAP = {
    // Cropland
    "Arable": "Low",
    "Arable field margins cultivated annually": "Low",
    "Arable field margins game bird mix": "Low",
    "Arable field margins pollen and nectar": "Medium",
    "Arable field margins tussocky": "Medium",
    // Grassland
    "Other neutral grassland": "Medium",
    "Lowland calcareous grassland": "Very High",
    "Lowland dry acid grassland": "Very High",
    "Other lowland acid grassland": "Medium",
    "Upland acid grassland": "High",
    "Modified grassland": "Low",
    "Floodplain wetland mosaic and coastal and floodplain grazing marsh": "High",
    "Traditional orchard": "High",
    // Heathland and shrub
    "Lowland heathland": "Very High",
    "Upland heathland": "High",
    "Mountain heathland": "High",
    "Blackthorn scrub": "Medium",
    "Bramble scrub": "Low",
    "Gorse scrub": "Medium",
    "Hawthorn scrub": "Medium",
    "Hazel scrub": "Medium",
    "Willow scrub": "Medium",
    "Mixed scrub": "Medium",
    // Woodland and forest
    "Lowland mixed deciduous woodland": "High",
    "Lowland beech and yew woodland": "High",
    "Wet woodland": "High",
    "Upland oakwood": "High",
    "Upland mixed ashwoods": "High",
    "Other woodland; broadleaved": "Medium",
    "Other woodland; mixed": "Medium",
    "Other coniferous woodland": "Low",
    "Wood-pasture and parkland": "Very High",
    "Felled": "Low",
    // Lakes
    "Ponds (priority habitat)": "Very High",
    "Ponds (non-priority habitat)": "Medium",
    "Lakes": "High",
    "Reservoirs": "Low",
    // Sparsely vegetated land
    "Bare ground": "Very Low",
    "Other inland rock and scree": "Medium",
    // Urban
    "Developed land; sealed surface": "Very Low",
    "Developed land; unsealed surface": "Very Low",
    "Vegetated garden": "Low",
    "Unvegetated garden": "Very Low",
    "Cemeteries and churchyards": "Medium",
    "Allotments": "Medium",
    "Open mosaic habitat on previously developed land": "High",
    "Public open space": "Low",
    "Sustainable drainage systems": "Medium",
    "Biodiverse green roof": "Medium",
    "Other green roof": "Low",
    "Green wall": "Low",
    // Individual trees
    "Individual tree - urban": "Medium",
    "Individual tree - rural": "Medium",
    // Intertidal sediment
    "Littoral coarse sediment": "Medium",
    "Littoral sand": "Medium",
    "Littoral mud": "Medium",
    // Intertidal hard structures
    "Artificial hard structures": "Low",
    "Artificial hard structures with integrated greening of grey infrastructure (IGGI)": "Medium"
  };

  // Legally irreplaceable habitats - these cannot have BNG calculations
  const IRREPLACEABLE_HABITATS = [
    "Lowland calcareous grassland",
    "Lowland dry acid grassland",
    "Lowland heathland",
    "Lowland mixed deciduous woodland",
    "Lowland beech and yew woodland",
    "Wet woodland",
    "Upland oakwood",
    "Upland mixed ashwoods",
    "Wood-pasture and parkland",
    "Ponds (priority habitat)"
  ];

  // Condition options for habitats
  const CONDITION_OPTIONS = [
    { value: "Good", text: "Good" },
    { value: "Fairly Good", text: "Fairly good" },
    { value: "Moderate", text: "Moderate" },
    { value: "Fairly Poor", text: "Fairly poor" },
    { value: "Poor", text: "Poor" },
    { value: "N/A - Other", text: "N/A - Other" }
  ];

  // Strategic significance options
  const STRATEGIC_SIGNIFICANCE_OPTIONS = [
    { value: "Low", text: "Low Strategic Significance" },
    { value: "Medium", text: "Medium Strategic Significance" },
    { value: "High", text: "High Strategic Significance" }
  ];

  // Module state
  let selectedParcelIndex = -1;
  let onSelectionChange = null;
  let onValidationChange = null;

  /**
   * Initialize the Habitat Attribution module
   * @param {Object} config - Configuration options
   * @param {Function} config.onSelectionChange - Called when parcel selection changes
   * @param {Function} config.onValidationChange - Called when validation state changes
   */
  function init(config = {}) {
    onSelectionChange = config.onSelectionChange || null;
    onValidationChange = config.onValidationChange || null;

    console.log('=== Habitat Attribution Module Initializing ===');

    setupFormEventListeners();
    renderForm();

    console.log('✓ Habitat Attribution module initialized');
  }

  /**
   * Set up event listeners for form elements
   */
  function setupFormEventListeners() {
    // Broad Habitat dropdown
    const broadHabitatSelect = document.getElementById('broad-habitat');
    if (broadHabitatSelect) {
      broadHabitatSelect.addEventListener('change', handleBroadHabitatChange);
    }

    // Habitat Type dropdown
    const habitatTypeSelect = document.getElementById('habitat-type');
    if (habitatTypeSelect) {
      habitatTypeSelect.addEventListener('change', handleHabitatTypeChange);
    }

    // Irreplaceable radio buttons
    const irreplaceableYes = document.getElementById('irreplaceable-yes');
    const irreplaceableNo = document.getElementById('irreplaceable-no');
    if (irreplaceableYes) {
      irreplaceableYes.addEventListener('change', handleIrreplaceableChange);
    }
    if (irreplaceableNo) {
      irreplaceableNo.addEventListener('change', handleIrreplaceableChange);
    }

    // Condition dropdown
    const conditionSelect = document.getElementById('condition');
    if (conditionSelect) {
      conditionSelect.addEventListener('change', handleConditionChange);
    }

    // Strategic Significance dropdown
    const strategicSelect = document.getElementById('strategic-significance');
    if (strategicSelect) {
      strategicSelect.addEventListener('change', handleStrategicSignificanceChange);
    }

    // User Comments textarea
    const commentsTextarea = document.getElementById('user-comments');
    if (commentsTextarea) {
      commentsTextarea.addEventListener('input', handleUserCommentsChange);
    }
  }

  /**
   * Handle Broad Habitat selection change
   * This triggers cascading updates to dependent fields
   */
  function handleBroadHabitatChange(evt) {
    const broadHabitat = evt.target.value;

    if (selectedParcelIndex < 0) return;

    // Update the parcel BNG data
    updateParcelProperty('broadHabitat', broadHabitat || null);

    // Clear dependent fields when broad habitat changes
    updateParcelProperty('habitatType', null);
    updateParcelProperty('condition', null);
    updateParcelProperty('distinctiveness', null);
    updateParcelProperty('irreplaceable', false);

    // Update Habitat Type dropdown options
    updateHabitatTypeOptions(broadHabitat);

    // Clear and disable condition until habitat type is selected
    const conditionSelect = document.getElementById('condition');
    if (conditionSelect) {
      conditionSelect.value = '';
      conditionSelect.disabled = true;
    }

    // Reset irreplaceable radio buttons
    const irreplaceableYes = document.getElementById('irreplaceable-yes');
    const irreplaceableNo = document.getElementById('irreplaceable-no');
    if (irreplaceableNo) {
      irreplaceableNo.checked = true;
    }
    if (irreplaceableYes) {
      irreplaceableYes.disabled = false;
    }

    // Hide irreplaceable warning
    hideIrreplaceableWarning();

    // Update distinctiveness display
    updateDistinctivenessDisplay(null);

    // Update validation state
    validateCurrentParcel();

    // Update the form header to show the new habitat name
    const parcelHeader = document.getElementById('selected-parcel-header');
    if (parcelHeader) {
      const parcelName = broadHabitat ? broadHabitat : `Parcel ${selectedParcelIndex + 1}`;
      parcelHeader.textContent = parcelName;
    }

    // Refresh the parcels list to show the new habitat name
    refreshParcelsList();
  }

  /**
   * Refresh the parcels list UI (calls SnapDrawing)
   */
  function refreshParcelsList() {
    if (window.SnapDrawing && window.SnapDrawing.updateParcelsList) {
      window.SnapDrawing.updateParcelsList();
    }
  }

  /**
   * Update the Habitat Type dropdown options based on selected Broad Habitat
   * @param {string} broadHabitat - Selected broad habitat
   */
  function updateHabitatTypeOptions(broadHabitat) {
    const habitatTypeSelect = document.getElementById('habitat-type');
    if (!habitatTypeSelect) return;

    // Clear existing options
    habitatTypeSelect.innerHTML = '<option value="">Select habitat type</option>';

    if (!broadHabitat || !HABITAT_TYPES[broadHabitat]) {
      habitatTypeSelect.disabled = true;
      return;
    }

    // Add options for the selected broad habitat
    const habitatTypes = HABITAT_TYPES[broadHabitat];
    habitatTypes.forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      habitatTypeSelect.appendChild(option);
    });

    habitatTypeSelect.disabled = false;
  }

  /**
   * Handle Habitat Type selection change
   */
  function handleHabitatTypeChange(evt) {
    const habitatType = evt.target.value;

    if (selectedParcelIndex < 0) return;

    // Update the parcel BNG data
    updateParcelProperty('habitatType', habitatType || null);

    // Auto-set distinctiveness based on habitat type
    const distinctiveness = habitatType ? DISTINCTIVENESS_MAP[habitatType] || null : null;
    updateParcelProperty('distinctiveness', distinctiveness);
    updateDistinctivenessDisplay(distinctiveness);

    // Enable condition dropdown if habitat type is selected
    const conditionSelect = document.getElementById('condition');
    if (conditionSelect) {
      conditionSelect.disabled = !habitatType;
      if (!habitatType) {
        conditionSelect.value = '';
        updateParcelProperty('condition', null);
      }
    }

    // Check if this is a legally irreplaceable habitat
    const isLegallyIrreplaceable = habitatType && IRREPLACEABLE_HABITATS.includes(habitatType);
    
    const irreplaceableYes = document.getElementById('irreplaceable-yes');
    const irreplaceableNo = document.getElementById('irreplaceable-no');
    
    if (isLegallyIrreplaceable) {
      // Auto-set and lock irreplaceable toggle
      if (irreplaceableYes) {
        irreplaceableYes.checked = true;
        irreplaceableYes.disabled = true;
      }
      if (irreplaceableNo) {
        irreplaceableNo.disabled = true;
      }
      updateParcelProperty('irreplaceable', true);
      showIrreplaceableWarning();
    } else {
      // Unlock irreplaceable toggle
      if (irreplaceableYes) {
        irreplaceableYes.disabled = false;
      }
      if (irreplaceableNo) {
        irreplaceableNo.disabled = false;
      }
      hideIrreplaceableWarning();
    }

    // Update validation state
    validateCurrentParcel();
  }

  /**
   * Handle Irreplaceable radio button change
   */
  function handleIrreplaceableChange(evt) {
    if (selectedParcelIndex < 0) return;

    const isIrreplaceable = evt.target.value === 'yes';
    updateParcelProperty('irreplaceable', isIrreplaceable);

    if (isIrreplaceable) {
      showIrreplaceableWarning();
    } else {
      hideIrreplaceableWarning();
    }

    // Update validation state
    validateCurrentParcel();
  }

  /**
   * Handle Condition selection change
   */
  function handleConditionChange(evt) {
    const condition = evt.target.value;

    if (selectedParcelIndex < 0) return;

    updateParcelProperty('condition', condition || null);

    // Show hint for intermediate conditions
    const conditionHint = document.getElementById('condition-hint');
    if (conditionHint) {
      if (condition === 'Fairly Good' || condition === 'Fairly Poor') {
        conditionHint.style.display = 'block';
      } else {
        conditionHint.style.display = 'none';
      }
    }

    // Update validation state
    validateCurrentParcel();
  }

  /**
   * Handle Strategic Significance selection change
   */
  function handleStrategicSignificanceChange(evt) {
    if (selectedParcelIndex < 0) return;

    updateParcelProperty('strategicSignificance', evt.target.value || 'Low');
  }

  /**
   * Handle User Comments change
   */
  function handleUserCommentsChange(evt) {
    if (selectedParcelIndex < 0) return;

    updateParcelProperty('userComments', evt.target.value || '');

    // Update validation state (comments required if irreplaceable)
    validateCurrentParcel();
  }

  /**
   * Update a BNG property on the selected parcel
   * @param {string} key - Property key
   * @param {*} value - Property value
   */
  function updateParcelProperty(key, value) {
    if (selectedParcelIndex < 0) return;

    if (window.SnapDrawing && window.SnapDrawing.setParcelBngProperty) {
      window.SnapDrawing.setParcelBngProperty(selectedParcelIndex, key, value);
    }
  }

  /**
   * Update the distinctiveness display
   * @param {string|null} distinctiveness - Distinctiveness value
   */
  function updateDistinctivenessDisplay(distinctiveness) {
    const display = document.getElementById('distinctiveness-display');
    if (display) {
      if (distinctiveness) {
        display.textContent = distinctiveness;
        display.className = 'govuk-tag govuk-tag--' + getDistinctivenessTagColor(distinctiveness);
      } else {
        display.textContent = 'Not set';
        display.className = 'govuk-tag govuk-tag--grey';
      }
    }
  }

  /**
   * Get tag color class for distinctiveness value
   * @param {string} distinctiveness - Distinctiveness value
   * @returns {string} GOV.UK tag color class
   */
  function getDistinctivenessTagColor(distinctiveness) {
    switch (distinctiveness) {
      case 'Very High': return 'purple';
      case 'High': return 'blue';
      case 'Medium': return 'yellow';
      case 'Low': return 'orange';
      case 'Very Low': return 'red';
      default: return 'grey';
    }
  }

  /**
   * Show the irreplaceable habitat warning banner
   */
  function showIrreplaceableWarning() {
    const warning = document.getElementById('irreplaceable-warning');
    if (warning) {
      warning.style.display = 'block';
    }
  }

  /**
   * Hide the irreplaceable habitat warning banner
   */
  function hideIrreplaceableWarning() {
    const warning = document.getElementById('irreplaceable-warning');
    if (warning) {
      warning.style.display = 'none';
    }
  }

  /**
   * Select a parcel by index
   * @param {number} index - Parcel index
   */
  function selectParcel(index) {
    if (selectedParcelIndex === index) return;

    selectedParcelIndex = index;

    console.log(`Parcel ${index + 1} selected for attribution`);

    // Notify SnapDrawing to highlight the parcel on the map
    if (window.SnapDrawing && window.SnapDrawing.highlightParcel) {
      window.SnapDrawing.highlightParcel(index);
    }

    // Render the form with parcel data
    renderForm();

    if (onSelectionChange) {
      onSelectionChange(index);
    }
  }

  /**
   * Deselect the current parcel
   */
  function deselectParcel() {
    if (selectedParcelIndex < 0) return;

    const previousIndex = selectedParcelIndex;
    selectedParcelIndex = -1;

    console.log('Parcel deselected');

    // Notify SnapDrawing to remove highlight
    if (window.SnapDrawing && window.SnapDrawing.unhighlightParcel) {
      window.SnapDrawing.unhighlightParcel(previousIndex);
    }

    // Render empty form state
    renderForm();

    if (onSelectionChange) {
      onSelectionChange(-1);
    }
  }

  /**
   * Get the currently selected parcel index
   * @returns {number} Selected parcel index or -1 if none selected
   */
  function getSelectedParcelIndex() {
    return selectedParcelIndex;
  }

  /**
   * Render the form based on current selection state
   */
  function renderForm() {
    const noSelectionMessage = document.getElementById('no-selection-message');
    const attributionForm = document.getElementById('attribution-form');

    if (!noSelectionMessage || !attributionForm) {
      return;
    }

    if (selectedParcelIndex < 0) {
      // No parcel selected - show message, hide form
      noSelectionMessage.style.display = 'block';
      attributionForm.style.display = 'none';
      return;
    }

    // Parcel selected - hide message, show form
    noSelectionMessage.style.display = 'none';
    attributionForm.style.display = 'block';

    // Get parcel BNG data
    let bngData = null;
    let areaHectares = 0;

    if (window.SnapDrawing && window.SnapDrawing.getParcelBngProperties) {
      bngData = window.SnapDrawing.getParcelBngProperties(selectedParcelIndex);
    }

    if (window.SnapDrawing && window.SnapDrawing.getHabitatParcels) {
      const parcels = window.SnapDrawing.getHabitatParcels();
      if (parcels[selectedParcelIndex]) {
        const geom = parcels[selectedParcelIndex].feature.getGeometry();
        areaHectares = geom.getArea() / 10000;
      }
    }

    // Initialize BNG data if not present
    if (!bngData) {
      bngData = getDefaultBngData();
    }

    // Update parcel header - show habitat name if available, otherwise "Parcel N"
    const parcelHeader = document.getElementById('selected-parcel-header');
    if (parcelHeader) {
      const parcelName = bngData.broadHabitat ? bngData.broadHabitat : `Parcel ${selectedParcelIndex + 1}`;
      parcelHeader.textContent = parcelName;
    }

    // Update area display
    const areaDisplay = document.getElementById('parcel-area-readonly');
    if (areaDisplay) {
      areaDisplay.textContent = areaHectares.toFixed(4);
    }

    // Populate Broad Habitat dropdown
    const broadHabitatSelect = document.getElementById('broad-habitat');
    if (broadHabitatSelect) {
      broadHabitatSelect.value = bngData.broadHabitat || '';
    }

    // Populate Habitat Type dropdown
    if (bngData.broadHabitat) {
      updateHabitatTypeOptions(bngData.broadHabitat);
    }
    const habitatTypeSelect = document.getElementById('habitat-type');
    if (habitatTypeSelect) {
      habitatTypeSelect.value = bngData.habitatType || '';
      habitatTypeSelect.disabled = !bngData.broadHabitat;
    }

    // Update irreplaceable radio buttons
    const irreplaceableYes = document.getElementById('irreplaceable-yes');
    const irreplaceableNo = document.getElementById('irreplaceable-no');
    
    const isLegallyIrreplaceable = bngData.habitatType && IRREPLACEABLE_HABITATS.includes(bngData.habitatType);
    
    if (bngData.irreplaceable) {
      if (irreplaceableYes) irreplaceableYes.checked = true;
      showIrreplaceableWarning();
    } else {
      if (irreplaceableNo) irreplaceableNo.checked = true;
      hideIrreplaceableWarning();
    }

    // Lock irreplaceable if legally required
    if (irreplaceableYes) irreplaceableYes.disabled = isLegallyIrreplaceable;
    if (irreplaceableNo) irreplaceableNo.disabled = isLegallyIrreplaceable;

    // Update distinctiveness display
    updateDistinctivenessDisplay(bngData.distinctiveness);

    // Populate Condition dropdown
    const conditionSelect = document.getElementById('condition');
    if (conditionSelect) {
      conditionSelect.value = bngData.condition || '';
      conditionSelect.disabled = !bngData.habitatType;
    }

    // Show/hide condition hint
    const conditionHint = document.getElementById('condition-hint');
    if (conditionHint) {
      if (bngData.condition === 'Fairly Good' || bngData.condition === 'Fairly Poor') {
        conditionHint.style.display = 'block';
      } else {
        conditionHint.style.display = 'none';
      }
    }

    // Populate Strategic Significance dropdown
    const strategicSelect = document.getElementById('strategic-significance');
    if (strategicSelect) {
      strategicSelect.value = bngData.strategicSignificance || 'Low';
    }

    // Populate User Comments
    const commentsTextarea = document.getElementById('user-comments');
    if (commentsTextarea) {
      commentsTextarea.value = bngData.userComments || '';
    }

    // Validate and update UI
    validateCurrentParcel();
  }

  /**
   * Get default BNG data structure
   * @returns {Object} Default BNG properties
   */
  function getDefaultBngData() {
    return {
      module: 'area',
      baseline: true,
      broadHabitat: null,
      habitatType: null,
      condition: null,
      strategicSignificance: 'Low',
      irreplaceable: false,
      distinctiveness: null,
      userComments: ''
    };
  }

  /**
   * Validate the currently selected parcel
   * @returns {Object} Validation result { valid: boolean, errors: string[] }
   */
  function validateCurrentParcel() {
    if (selectedParcelIndex < 0) {
      return { valid: true, errors: [] };
    }

    return validateParcel(selectedParcelIndex);
  }

  /**
   * Validate a specific parcel
   * @param {number} index - Parcel index
   * @returns {Object} Validation result { valid: boolean, errors: string[] }
   */
  function validateParcel(index) {
    const errors = [];

    let bngData = null;
    let areaHectares = 0;

    if (window.SnapDrawing && window.SnapDrawing.getParcelBngProperties) {
      bngData = window.SnapDrawing.getParcelBngProperties(index);
    }

    if (window.SnapDrawing && window.SnapDrawing.getHabitatParcels) {
      const parcels = window.SnapDrawing.getHabitatParcels();
      if (parcels[index]) {
        const geom = parcels[index].feature.getGeometry();
        areaHectares = geom.getArea() / 10000;
      }
    }

    if (!bngData) {
      bngData = getDefaultBngData();
    }

    // Check required fields
    if (!bngData.broadHabitat) {
      errors.push('Broad Habitat is required');
    }

    if (!bngData.habitatType) {
      errors.push('Habitat Type is required');
    }

    if (!bngData.condition) {
      errors.push('Condition is required');
    }

    if (areaHectares <= 0) {
      errors.push('Area must be greater than 0');
    }

    // If irreplaceable, user comments are required
    if (bngData.irreplaceable && (!bngData.userComments || bngData.userComments.trim() === '')) {
      errors.push('User comments are required for irreplaceable habitats');
    }

    const valid = errors.length === 0;

    // Update validation display for current parcel
    if (index === selectedParcelIndex) {
      updateValidationDisplay(valid, errors);
    }

    // Update parcel list indicator
    updateParcelValidationIndicator(index, valid);

    if (onValidationChange) {
      onValidationChange(index, valid, errors);
    }

    return { valid, errors };
  }

  /**
   * Validate all parcels
   * @returns {Object} Validation result { valid: boolean, errors: Object[] }
   */
  function validateAllParcels() {
    const results = [];
    let allValid = true;

    if (window.SnapDrawing && window.SnapDrawing.getHabitatParcels) {
      const parcels = window.SnapDrawing.getHabitatParcels();
      
      for (let i = 0; i < parcels.length; i++) {
        const result = validateParcel(i);
        results.push({
          parcelIndex: i,
          valid: result.valid,
          errors: result.errors
        });
        if (!result.valid) {
          allValid = false;
        }
      }
    }

    return { valid: allValid, results };
  }

  /**
   * Update the validation error display
   * @param {boolean} valid - Whether the parcel is valid
   * @param {string[]} errors - Array of error messages
   */
  function updateValidationDisplay(valid, errors) {
    const validationSummary = document.getElementById('validation-summary');
    if (!validationSummary) return;

    if (valid) {
      validationSummary.style.display = 'none';
      return;
    }

    validationSummary.style.display = 'block';
    const errorList = validationSummary.querySelector('.govuk-error-summary__list');
    if (errorList) {
      errorList.innerHTML = errors.map(error => `<li>${error}</li>`).join('');
    }
  }

  /**
   * Update validation indicator in the parcel list
   * @param {number} index - Parcel index
   * @param {boolean} valid - Whether the parcel is valid
   */
  function updateParcelValidationIndicator(index, valid) {
    const indicator = document.getElementById(`parcel-status-${index}`);
    if (indicator) {
      if (valid) {
        indicator.innerHTML = '<span class="govuk-tag govuk-tag--green">Complete</span>';
      } else {
        indicator.innerHTML = '<span class="govuk-tag govuk-tag--red">Incomplete</span>';
      }
    }
  }

  /**
   * Check if a parcel is complete (all required fields filled)
   * @param {number} index - Parcel index
   * @returns {boolean} Whether the parcel is complete
   */
  function isParcelComplete(index) {
    const result = validateParcel(index);
    return result.valid;
  }

  /**
   * Get the Broad Habitat types list
   * @returns {string[]} Array of broad habitat types
   */
  function getBroadHabitatTypes() {
    return Object.keys(HABITAT_TYPES);
  }

  /**
   * Get Habitat Types for a given Broad Habitat
   * @param {string} broadHabitat - Broad habitat type
   * @returns {string[]} Array of habitat types
   */
  function getHabitatTypesFor(broadHabitat) {
    return HABITAT_TYPES[broadHabitat] || [];
  }

  /**
   * Get distinctiveness for a habitat type
   * @param {string} habitatType - Habitat type
   * @returns {string|null} Distinctiveness value
   */
  function getDistinctiveness(habitatType) {
    return DISTINCTIVENESS_MAP[habitatType] || null;
  }

  /**
   * Check if a habitat type is legally irreplaceable
   * @param {string} habitatType - Habitat type
   * @returns {boolean} Whether the habitat is irreplaceable
   */
  function isHabitatIrreplaceable(habitatType) {
    return IRREPLACEABLE_HABITATS.includes(habitatType);
  }

  /**
   * Get condition options
   * @returns {Object[]} Array of condition option objects
   */
  function getConditionOptions() {
    return CONDITION_OPTIONS;
  }

  /**
   * Get strategic significance options
   * @returns {Object[]} Array of strategic significance option objects
   */
  function getStrategicSignificanceOptions() {
    return STRATEGIC_SIGNIFICANCE_OPTIONS;
  }

  // Export public API
  window.HabitatAttribution = {
    init: init,
    selectParcel: selectParcel,
    deselectParcel: deselectParcel,
    getSelectedParcelIndex: getSelectedParcelIndex,
    renderForm: renderForm,
    validateParcel: validateParcel,
    validateAllParcels: validateAllParcels,
    isParcelComplete: isParcelComplete,
    getBroadHabitatTypes: getBroadHabitatTypes,
    getHabitatTypesFor: getHabitatTypesFor,
    getDistinctiveness: getDistinctiveness,
    isHabitatIrreplaceable: isHabitatIrreplaceable,
    getConditionOptions: getConditionOptions,
    getStrategicSignificanceOptions: getStrategicSignificanceOptions,
    getDefaultBngData: getDefaultBngData
  };

})(window);
