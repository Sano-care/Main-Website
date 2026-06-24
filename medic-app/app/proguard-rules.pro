# R8 keep-rules for the minified release build (medic-app v0.6.1+).
#
# Hilt (Dagger), Daily.co, Firebase, OkHttp, Compose, and Retrofit all ship their
# own consumer R8 rules, so they need no manual keeps here. The two things R8 full
# mode WILL break without explicit rules are (1) kotlinx.serialization (it relies
# on synthetic `serializer()` / `$serializer` members R8 would strip/rename) and
# (2) our Retrofit service interfaces — both kept below.

# ── Attributes needed for serialization generics + annotation-driven reflection ──
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault

# ── kotlinx.serialization — official R8 keep block ──────────────────────────────
# Keep `Companion` of @Serializable classes.
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
# Keep `serializer()` on the companion of @Serializable classes.
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
# Keep `INSTANCE.serializer()` of @Serializable objects.
-if @kotlinx.serialization.Serializable class ** {
    public static ** INSTANCE;
}
-keepclassmembers class <1> {
    public static <1> INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}

# ── Our @Serializable DTOs (the #1 break risk) ──────────────────────────────────
# Keep the model classes + their generated $$serializer wholesale. They're tiny
# data classes, so the size cost is negligible and it guarantees JSON (de)ser works.
-keep class in.sanocare.medic.data.network.** { *; }
-keepclassmembers class in.sanocare.medic.data.network.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# ── Retrofit — belt-and-suspenders over its own consumer rules ──────────────────
# Keep our Retrofit service interfaces and their HTTP-annotated methods.
-keep interface in.sanocare.medic.data.network.*Api { *; }
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
# Retrofit/OkHttp pull in optional platform classes that R8 flags but never runs.
-dontwarn org.codehaus.mojo.animal_sniffer.*
-dontwarn javax.annotation.**
