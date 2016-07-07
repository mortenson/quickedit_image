/**
 * @file
 * ContentEditable-based in-place editor for images.
 */

(function ($, _, Drupal) {

  'use strict';

  Drupal.quickedit.editors.image = Drupal.quickedit.EditorView.extend(/** @lends Drupal.quickedit.editors.image# */{

    /**
     * @constructs
     *
     * @augments Drupal.quickedit.EditorView
     *
     * @param {object} options
     *   Options for the plain text editor.
     */
    initialize: function (options) {
      Drupal.quickedit.EditorView.prototype.initialize.call(this, options);
      // Set our original value to our current HTML (for reverting).
      this.model.set('originalValue', $.trim(this.$el.html()));
      // $.val() callback function for copying input from our custom form to
      // the Quickedit Field Form. Pretty sneaky!
      this.model.set('currentValue', function (index, value) {
        var matches = $(this).attr('name').match(/(alt|title)]$/);
        if (matches) {
          var name = matches[1];
          var $input = $('.quickedit-image-field-info input[name="' + name + '"]');
          if ($input.length) {
            return $input.val();
          }
        }
      });
    },

    /**
     * Template to display errors inline with the toolbar.
     */
    template_errors: _.template(
      '<div class="quickedit-image-errors">' +
      '  <%= errors %>' +
      '</div>'
    ),

    /**
     * Template to display the dropzone area.
     */
    template_dropzone: _.template(
      '<div class="quickedit-image-dropzone <%- state %>">' +
      '  <i class="quickedit-image-icon"></i>' +
      '  <span class="quickedit-image-text"><%- text %></span>' +
      '</div>'
    ),

    /**
     * Template to display the toolbar.
     */
    template_toolbar: _.template(
      '<form class="quickedit-image-field-info">' +
      '<% if (alt_field) { %>' +
      '  <label for="alt" class="<% if (alt_field_required) { %>form-required<%} %>">Alt</label>' +
      '  <input type="text" placeholder="<%- alt %>" value="<%- alt %>" name="alt" <% if (alt_field_required) { %>required<%} %>/>' +
      '<% } %>' +
      '<% if (title_field) { %>' +
      '  <label for="title" class="<% if (alt_field_required) { %>form-required<%} %>">Title</label>' +
      '  <input type="text" placeholder="<%- title %>" value="<%- title %>" name="title" <% if (title_field_required) { %>required<%} %>/>' +
      '<% } %>' +
      '</form>'
    ),

    /**
     * @inheritdoc
     *
     * @param {Drupal.quickedit.FieldModel} fieldModel
     *   The field model that holds the state.
     * @param {string} state
     *   The state to change to.
     * @param {object} options
     *   State options, if needed by the state change.
     */
    stateChange: function (fieldModel, state, options) {
      var from = fieldModel.previous('state');
      switch (state) {
        case 'inactive':
          break;

        case 'candidate':
          if (from !== 'inactive') {
            this.$el.find('.quickedit-image-dropzone').remove();
            this.$el.removeClass('quickedit-image-element');
          }
          if (from === 'invalid') {
            this.removeValidationErrors();
          }
          break;

        case 'highlighted':
          break;

        case 'activating':
          // Defer updating the field model until the current state change has
          // propagated, to not trigger a nested state change event.
          _.defer(function () {
            fieldModel.set('state', 'active');
          });
          break;

        case 'active':
          // Once active, render the dropzone area and our custom toolbar form.
          var self = this;

          // Indicate that this element is being edited by Quickedit Image.
          this.$el.addClass('quickedit-image-element');

          var $dropzone = this.renderDropzone('upload', Drupal.t('Drag file here or click to upload'));

          // Generic event callback to stop event behavior and bubbling.
          var stopEvent = function (e) {
            e.preventDefault();
            e.stopPropagation();
          };

          // Prevent the browser's default behavior when dragging files onto
          // the document (usually opens them in the same tab).
          $dropzone.on('dragover', stopEvent);
          $dropzone.on('dragenter', function (e) {
            stopEvent(e);
            $(this).addClass('hover');
          });
          $dropzone.on('dragleave', function (e) {
            stopEvent(e);
            $(this).removeClass('hover');
          });

          $dropzone.on('drop', function (e){
            stopEvent(e);

            // Only respond when a file is dropped (could be another element).
            if(e.originalEvent.dataTransfer && e.originalEvent.dataTransfer.files.length){
              $(this).removeClass('hover');
              self.uploadImage(e.originalEvent.dataTransfer.files[0]);
            }
          });

          $dropzone.on('click', function (e) {
            stopEvent(e);
            var $input = $('<input type="file">').trigger('click');
            $input.change(function () {
              if (this.files.length) {
                self.uploadImage(this.files[0]);
              }
            });
          });

          this.renderToolbar(fieldModel);
          break;

        case 'changed':
          break;

        case 'saving':
          if (from === 'invalid') {
            this.removeValidationErrors();
          }

          // Before we submit, validate the alt/title text fields.
          this.save(options);
          break;

        case 'saved':
          break;

        case 'invalid':
          this.showValidationErrors();
          break;
      }
    },

    /**
     * Validates/uploads a given file.
     *
     * @param {File} file
     *   The file to upload.
     */
    uploadImage: function (file) {
      // Indicate loading by adding a special class to our icon.
      this.renderDropzone('upload loading', Drupal.t('Uploading <i>@file</i>...', {'@file': file.name}));

      // Build a valid URL for our endpoint.
      var fieldID = this.fieldModel.get('fieldID');
      var url = Drupal.quickedit.util.buildUrl(fieldID, Drupal.url('quickedit_image/!entity_type/!id/!field_name/!langcode/!view_mode'));

      // Construct form data that our endpoint can consume.
      var data = new FormData();
      data.append('files[image]', file);

      // Construct a POST request to our endpoint.
      this.ajax('POST', url, data, this.handleUploadResponse);
    },

    /**
     * AJAX success handler for File uploads.
     *
     * @param {object} response
     *   A response object passed on by $.ajax.
     */
    handleUploadResponse: function (response) {
      var $el = $(this.fieldModel.get('el'));

      // Indicate that the field has changed - this enables the
      // "Save" button.
      this.fieldModel.set('state', 'changed');
      this.fieldModel.get('entity').set('inTempStore', true);
      this.removeValidationErrors();

      // Replace our innerHTML with the new image. If we replaced
      // our entire element with data.html, we would have to
      // implement complicated logic like what's in
      // Drupal.quickedit.AppView.renderUpdatedField.
      var content = $(response.html).closest('[data-quickedit-field-id]').html();
      $el.html(content);
    },

    /**
     * Utility function to make an AJAX request to the server.
     *
     * @param {string} type
     *   The type of request (i.e. GET, POST, PUT, DELETE, etc.)
     * @param {string} url
     *   The URL for the request.
     * @param {*} data
     *   The data to send to the server.
     * @param {function} callback
     *   A callback function used when a request is successful without errors.
     */
    ajax: function (type, url, data, callback) {
      $.ajax({
        url: url,
        context: this,
        type: type,
        data: data,
        dataType: 'json',
        cache: false,
        contentType: false,
        processData: false,
        success: function(response) {
          if (response.main_error) {
            this.renderDropzone('error', response.main_error);
            if (response.errors.length) {
              this.model.set('validationErrors', response.errors);
            }
            this.showValidationErrors();
          }
          else {
            callback.call(this, response);
          }
        },
        error: function() {
          this.renderDropzone('error', Drupal.t('A server error has occurred.'));
        }
      });
    },

    /**
     * Renders our toolbar form for editing metadata.
     *
     * @param {Drupal.quickedit.FieldModel} fieldModel
     *   The current Field Model.
     */
    renderToolbar: function (fieldModel) {
      var $toolbar = $('.quickedit-image-field-info');
      if ($toolbar.length === 0) {
        // Perform an AJAX request for extra image info (alt/title).
        var fieldID = fieldModel.get('fieldID');
        var url = Drupal.quickedit.util.buildUrl(fieldID, Drupal.url('quickedit_image/!entity_type/!id/!field_name/!langcode/!view_mode/info'));
        var self = this;
        self.ajax('GET', url, null, function (response) {
          $toolbar = $(self.template_toolbar(response));
          $('#' + fieldModel.toolbarView.getMainWysiwygToolgroupId()).append($toolbar);
          $toolbar.on('keyup paste', function () {
            fieldModel.set('state', 'changed');
          });
        });
      }
    },

    /**
     * Renders our dropzone element.
     *
     * @param {string} state
     *   The current state of our editor. Only used for visual styling.
     * @param {string} text
     *   The text to display in the dropzone area.
     */
    renderDropzone: function (state, text) {
      var $dropzone = this.$el.find('.quickedit-image-dropzone');
      // If the element already exists, modify its contents.
      if ($dropzone.length) {
        $dropzone.removeClass('upload error hover loading');
        $dropzone.addClass('.quickedit-image-dropzone ' + state);
        $dropzone.children('.quickedit-image-text').html(text);
      }
      else {
        $dropzone = $(this.template_dropzone({
          state: state,
          text: text
        }));
        this.$el.append($dropzone);
      }

      return $dropzone;
    },

    /**
     * @inheritdoc
     */
    revert: function () {
      this.$el.html(this.model.get('originalValue'));
    },

    /**
     * @inheritdoc
     */
    getQuickEditUISettings: function () {
      return {padding: false, unifiedToolbar: true, fullWidthToolbar: true, popup: false};
    },

    /**
     * @inheritdoc
     */
    showValidationErrors: function () {
      var $errors = $(this.template_errors({
        errors: this.model.get('validationErrors')
      }));
      $('#' + this.fieldModel.toolbarView.getMainWysiwygToolgroupId())
        .append($errors);
      this.getEditedElement()
        .addClass('quickedit-validation-error');
    },

    /**
     * @inheritdoc
     */
    removeValidationErrors: function () {
      $('#' + this.fieldModel.toolbarView.getMainWysiwygToolgroupId())
        .find('.quickedit-image-errors').remove();
      this.getEditedElement()
        .removeClass('quickedit-validation-error');
    }

  });

})(jQuery, _, Drupal);
