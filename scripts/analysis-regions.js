/* Display subdivisions only. Preserve the workbook's original research groups.
 * The first listed country/territory is a reproducible catalogue location, not
 * an inference about the imposing authority or every border in the record. */
(function(root){
 'use strict';
 const groups={
  Europe:{
   'Northern Europe':['Denmark','Estonia','Finland','Iceland','Ireland','Latvia','Lithuania','Norway','Sweden','United Kingdom','Faroe Islands','Guernsey','Isle of Man','Jersey'],
   'Western Europe':['Austria','Belgium','France','Germany','Liechtenstein','Luxembourg','Monaco','Netherlands','Switzerland'],
   'Southern Europe':['Albania','Andorra','Bosnia and Herzegovina','Croatia','Cyprus','Gibraltar','Gibraltar (UK territory)','Greece','Italy','Kosovo','Kosovo (disputed status)','Malta','Montenegro','North Macedonia','Portugal','San Marino','Serbia','Slovenia','Spain','Vatican City'],
   'Eastern Europe':['Belarus','Bulgaria','Czechia','Czech Republic','Hungary','Moldova','Poland','Romania','Russia','Slovakia','Ukraine']
  },
  Americas:{
   'North America':['Canada','United States','United States of America','Mexico','Greenland','Bermuda','Saint Pierre and Miquelon'],
   'Central America':['Belize','Costa Rica','El Salvador','Guatemala','Honduras','Nicaragua','Panama'],
   'Caribbean':['Anguilla','Antigua and Barbuda','Aruba','Bahamas','Barbados','Bonaire','British Virgin Islands','Cayman Islands','Cuba','Curaçao','Dominica','Dominican Republic','Grenada','Guadeloupe','Haiti','Jamaica','Martinique','Montserrat','Puerto Rico','Saint Barthélemy','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Saint-Martin','Saint-Martin (France)','Sint Maarten','Sint Maarten (Kingdom of Netherlands)','Trinidad and Tobago','Turks and Caicos Islands','United States Virgin Islands'],
   'South America':['Argentina','Bolivia','Brazil','Chile','Colombia','Ecuador','Falkland Islands','French Guiana','French Guiana (France)','Guyana','Paraguay','Peru','Suriname','Uruguay','Venezuela']
  }
 };
 const lookup=Object.fromEntries(Object.entries(groups).map(([region,areas])=>[region,
  new Map(Object.entries(areas).flatMap(([area,countries])=>countries.map(country=>[country,area])))
 ]));
 function area(event){
  const region=event.region||'Unassigned research area';
  if(!lookup[region])return region;
  return lookup[region].get(event.countries?.[0])||region+' (subregion unassigned)';
 }
 const api=Object.freeze({area});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BorderAnalysisRegions=api;
})(typeof window!=='undefined'?window:globalThis);
