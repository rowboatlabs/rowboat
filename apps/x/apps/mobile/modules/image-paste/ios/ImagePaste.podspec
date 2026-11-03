Pod::Spec.new do |s|
  s.name           = 'ImagePaste'
  s.version        = '1.0.0'
  s.summary        = 'Paste images from the clipboard into the Spaces composer'
  s.author         = 'Rowboat Labs'
  s.homepage       = 'https://github.com/rowboatlabs/rowboat'
  s.license        = 'Apache-2.0'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
