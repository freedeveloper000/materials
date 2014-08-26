angular.module('material.services.expectAria', [])

.service('$expectAria', [
  '$log',
  ExpectAriaService
]);

function ExpectAriaService($log) {
  var messageTemplate = 'ARIA: Attribute "%s", required for accessibility, is missing on "%s"!';
  var defaultValueTemplate = 'Default value was set: %s="%s".';

  return function expect(element, attrName, defaultValue) {

    var template = messageTemplate;
    var node = element[0];
    if (!node.hasAttribute(attrName)) {
      var hasDefault = angular.isDefined(defaultValue);

      if (hasDefault) {
        defaultValue = String(defaultValue).trim();
        $log.warn(messageTemplate + ' ' + defaultValueTemplate,
                  attrName, getTagString(node), attrName, defaultValue);
        element.attr(attrName, defaultValue);
      } else {
        $log.warn(defaultValueTemplate, attrName, getTagString(node));
      }
    }
  };

  /**
   * Gets the tag definition from a node's outerHTML
   * @example getTagDefinition(
   *   '<material-button foo="bar">Hello</material-button>'
   * ) // => '<material-button foo="bar">'
   */
  function getTagString(node) {
    var html = node.outerHTML;
    var closingIndex = html.indexOf('>');
    return html.substring(0, closingIndex + 1);
  }
}
