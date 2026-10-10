import Foundation

/// Image operations can block for a whole download. They run on this concurrent queue, never on
/// Expo's shared serial AsyncFunction queue, so confirmations, disconnect and logout do not wait for them.
public enum ImageOperations {
  public static let queue = DispatchQueue(label: "expo.modules.whatsapp.images", qos: .userInitiated, attributes: .concurrent)
}
